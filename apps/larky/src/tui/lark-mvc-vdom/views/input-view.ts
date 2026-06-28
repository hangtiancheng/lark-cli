import { z } from "zod";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import type { VDomNode } from "@lark.js/mvc";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createSimpleStore as createStore } from "../stores/create-store.js";
import { keyboard } from "../runtime/keyboard-input.js";
import { BORDER_COLORS, CMD_COLORS, COLORS, ICONS } from "../utils/styles.js";
import { intArg, boolArg } from "../../../utils/index.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";

const CommandSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  description: z.string(),
  type: z.string(),
});

type Command = z.infer<typeof CommandSchema>;

const CommandArraySchema = z.array(CommandSchema);

const CommandUsageTrackerSchema = z.custom<CommandUsageTracker>(
  (v): v is CommandUsageTracker =>
    typeof v === "object" &&
    v !== null &&
    "getRecentlyUsed" in v &&
    typeof v.getRecentlyUsed === "function",
);

interface CommandUsageTracker {
  getRecentlyUsed(count: number): string[];
}

const PermissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);
type PermissionMode = z.infer<typeof PermissionModeSchema>;

const InputBoxPropsSchema = z.object({
  onSubmit: z.custom<(text: string) => void>(
    (v): v is (text: string) => void => typeof v === "function",
  ),
  disabled: z.boolean().optional(),
  history: z.array(z.string()).optional(),
  commands: CommandArraySchema.optional(),
  onEscape: z.custom<() => void>((v): v is () => void => typeof v === "function").optional(),
  inputState: z.enum(["idle", "focused", "agent", "error"]).optional(),
  usageTracker: CommandUsageTrackerSchema.optional(),
  permMode: PermissionModeSchema.optional(),
  onModeChange: z
    .custom<(mode: PermissionMode) => void>(
      (v): v is (mode: PermissionMode) => void => typeof v === "function",
    )
    .optional(),
  workDir: z.string().optional(),
});

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  history?: string[];
  commands?: Command[];
  onEscape?: () => void;
  inputState?: "idle" | "focused" | "agent" | "error";
  usageTracker?: CommandUsageTracker;
  permMode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => void;
  workDir?: string;
}

interface InputState {
  lines: string[];
  cursorLine: number;
  historyIndex: number;
  dropdownIndex: number;
  dropdownDismissed: boolean;
  cursorVisible: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "coverage",
]);

const MODEL_DISPLAY: Record<PermissionMode, { name: string; color: string }> = {
  default: { name: "default", color: "gray" },
  acceptEdits: { name: "Accept Edits", color: "green" },
  plan: { name: "Plan", color: "yellow" },
  bypassPermissions: { name: "YOLO", color: "red" },
};

const MODEL_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

function scanWorkdirFiles(root: string, max = 2000): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (out.length >= max) {
      return;
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= max) {
        return;
      }
      if (name.startsWith(".") || SKIP_DIRS.has(name)) {
        continue;
      }
      const full = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, relPath);
      } else {
        out.push(relPath);
      }
    }
  };
  walk(root, "");
  return out;
}

const CMD_COLOR_MAP: Record<string, string> = CMD_COLORS;

export const InputView = defineTerminalView((ctx, props?: Record<string, unknown>) => {
  const parsed = InputBoxPropsSchema.safeParse(props);
  const validProps = parsed.success ? parsed.data : undefined;

  const onSubmit: InputBoxProps["onSubmit"] =
    validProps?.onSubmit ??
    ((_text: string) => {
      /* noop */
    });
  const disabled = validProps?.disabled ?? false;
  const history = validProps?.history ?? [];
  const commands = validProps?.commands ?? [];
  const onEscape = validProps?.onEscape;
  const inputState = validProps?.inputState ?? "idle";
  const usageTracker = validProps?.usageTracker;
  const permMode = validProps?.permMode ?? "default";
  const onModeChange = validProps?.onModeChange;
  const workDir = validProps?.workDir ?? ".";

  const store = createStore<InputState>({
    lines: [""],
    cursorLine: 0,
    historyIndex: -1,
    dropdownIndex: 0,
    dropdownDismissed: false,
    cursorVisible: true,
  });

  tuiUseStore(store);

  let fileCache: string[] | null = null;

  tuiUseEffect(() => {
    const timer = setInterval(() => {
      store.setState((s) => ({ cursorVisible: !s.cursorVisible }));
    }, 530);
    return () => {
      clearInterval(timer);
    };
  }, []);

  tuiUseEffect(() => {
    const off = keyboard.on((input, key) => {
      const state = store.getState();
      const { lines, cursorLine, dropdownIndex, dropdownDismissed } = state;
      const isMultiline = lines.length > 1;

      const first = lines[0];
      let filteredCmds: Command[] = [];

      if (first.startsWith("/") && !isMultiline) {
        const query = first.slice(1).toLowerCase();
        if (!query.includes(" ")) {
          if (!query) {
            if (!usageTracker) {
              filteredCmds = commands;
            } else {
              const recentNames = new Set(usageTracker.getRecentlyUsed(5));
              const recent = commands.filter((c) => recentNames.has(c.name));
              const rest = commands.filter((c) => !recentNames.has(c.name));
              filteredCmds = [...recent, ...rest];
            }
          } else {
            const seen = new Set<string>();
            const result: Command[] = [];
            const add = (cmd: Command) => {
              if (!seen.has(cmd.name)) {
                seen.add(cmd.name);
                result.push(cmd);
              }
            };

            for (const c of commands) {
              if (c.name.toLowerCase() === query) {
                add(c);
              }
            }
            for (const c of commands) {
              if (c.aliases.some((a) => a.toLowerCase() === query)) {
                add(c);
              }
            }
            for (const c of commands) {
              if (c.name.toLowerCase().startsWith(query)) {
                add(c);
              }
            }
            for (const c of commands) {
              if (c.aliases.some((a) => a.toLowerCase().startsWith(query))) {
                add(c);
              }
            }

            filteredCmds = result;
          }
        }
      }

      const showDropdown =
        filteredCmds.length > 0 && first.startsWith("/") && !isMultiline && !dropdownDismissed;

      let atQuery: string | null = null;
      if (!first.startsWith("/")) {
        const line = lines[cursorLine] ?? "";
        const m = /(?:^|\s)@([^\s]*)$/.exec(line);
        atQuery = m ? m[1] : null;
      }

      let filteredFiles: string[] = [];
      if (atQuery !== null) {
        fileCache ??= scanWorkdirFiles(workDir);
        const q = atQuery.toLowerCase();
        if (!q) {
          filteredFiles = fileCache.slice(0, 8);
        } else {
          const pre = fileCache.filter((f) => f.toLowerCase().startsWith(q));
          const sub = fileCache.filter(
            (f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q),
          );
          filteredFiles = [...pre, ...sub].slice(0, 8);
        }
      }

      const showAtDropdown = !showDropdown && atQuery !== null && filteredFiles.length > 0;

      const completeAt = (path: string) => {
        store.setState((s) => {
          const u = [...s.lines];
          u[s.cursorLine] = (u[s.cursorLine] ?? "").replace(/@([^\s]*)$/, `@${path} `);
          return { lines: u, dropdownIndex: 0 };
        });
      };

      if (key.escape || input === "\x1b") {
        if (showDropdown) {
          store.setState({ dropdownDismissed: true, dropdownIndex: 0 });
          return;
        }
        if (showAtDropdown) {
          store.setState((s) => {
            const u = [...s.lines];
            u[s.cursorLine] = (u[s.cursorLine] ?? "").replace(/@([^\s]*)$/, "");
            return { lines: u, dropdownIndex: 0 };
          });
          return;
        }
        onEscape?.();
        return;
      }

      if (disabled) {
        return;
      }

      const hasReturn = key.return || input.includes("\r") || input.includes("\n");
      const cleanInput = input.replace(/[\r\n]/g, "");

      if (hasReturn && (key.shift || (key.ctrl && input === "\n"))) {
        store.setState((s) => {
          const updated = [...s.lines];
          updated.splice(s.cursorLine + 1, 0, "");
          return { lines: updated, cursorLine: s.cursorLine + 1 };
        });
        return;
      }

      if (hasReturn) {
        if (showAtDropdown && filteredFiles[dropdownIndex]) {
          completeAt(filteredFiles[dropdownIndex]);
          return;
        }
        if (showDropdown && filteredCmds.length > 0 && dropdownIndex < filteredCmds.length) {
          const selected = filteredCmds[dropdownIndex];
          store.setState({
            lines: ["/" + selected.name + " "],
            cursorLine: 0,
            dropdownIndex: 0,
          });
          return;
        }

        const finalLine = cleanInput ? lines[cursorLine] + cleanInput : lines[cursorLine];
        const updated = [...lines];
        updated[cursorLine] = finalLine;
        const finalValue = updated.join("\n").trim();
        if (finalValue) {
          onSubmit(finalValue);
          store.setState({
            lines: [""],
            cursorLine: 0,
            historyIndex: -1,
            dropdownIndex: 0,
            dropdownDismissed: false,
          });
        }
        return;
      }

      if ((input === "\x1b[Z" || (key.tab && key.shift)) && onModeChange) {
        const idx = MODEL_CYCLE.indexOf(permMode);
        const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length];
        onModeChange(next);
        return;
      }

      if (key.tab && showAtDropdown && filteredFiles[dropdownIndex]) {
        completeAt(filteredFiles[dropdownIndex]);
        return;
      }

      if (
        key.tab &&
        first.startsWith("/") &&
        filteredCmds.length > 0 &&
        dropdownIndex < filteredCmds.length
      ) {
        const selected = filteredCmds[dropdownIndex];
        store.setState({
          lines: ["/" + selected.name + " "],
          cursorLine: 0,
          dropdownIndex: 0,
        });
        return;
      }

      if (key.backspace || key.delete) {
        store.setState((s) => {
          const updated = [...s.lines];
          if (updated[s.cursorLine].length > 0) {
            updated[s.cursorLine] = updated[s.cursorLine].slice(0, -1);
            return { lines: updated };
          } else if (s.cursorLine > 0) {
            updated.splice(s.cursorLine, 1);
            return { lines: updated, cursorLine: s.cursorLine - 1 };
          }
          return {};
        });
        return;
      }

      if (key.upArrow) {
        if (showAtDropdown) {
          store.setState((s) => ({
            dropdownIndex: s.dropdownIndex > 0 ? s.dropdownIndex - 1 : filteredFiles.length - 1,
          }));
          return;
        }
        if (showDropdown) {
          store.setState((s) => ({
            dropdownIndex: s.dropdownIndex > 0 ? s.dropdownIndex - 1 : filteredCmds.length - 1,
          }));
          return;
        }
        if (isMultiline && cursorLine > 0) {
          store.setState((s) => ({ cursorLine: s.cursorLine - 1 }));
          return;
        }
        if (!isMultiline && history.length > 0) {
          store.setState((s) => {
            const nextIdx =
              s.historyIndex < history.length - 1 ? s.historyIndex + 1 : s.historyIndex;
            const entry = history[history.length - 1 - nextIdx] ?? "";
            return {
              historyIndex: nextIdx,
              lines: entry.split("\n"),
              cursorLine: 0,
            };
          });
          return;
        }
        return;
      }

      if (key.downArrow) {
        if (showAtDropdown) {
          store.setState((s) => ({
            dropdownIndex: s.dropdownIndex < filteredFiles.length - 1 ? s.dropdownIndex + 1 : 0,
          }));
          return;
        }
        if (showDropdown) {
          store.setState((s) => ({
            dropdownIndex: s.dropdownIndex < filteredCmds.length - 1 ? s.dropdownIndex + 1 : 0,
          }));
          return;
        }
        if (isMultiline && cursorLine < lines.length - 1) {
          store.setState((s) => ({ cursorLine: s.cursorLine + 1 }));
          return;
        }
        if (!isMultiline) {
          store.setState((s) => {
            if (s.historyIndex > 0) {
              const nextIdx = s.historyIndex - 1;
              const entry = history[history.length - 1 - nextIdx] ?? "";
              return {
                historyIndex: nextIdx,
                lines: entry.split("\n"),
                cursorLine: 0,
              };
            } else if (s.historyIndex === 0) {
              return { historyIndex: -1, lines: [""], cursorLine: 0 };
            }
            return {};
          });
        }
        return;
      }

      if (cleanInput && !key.ctrl && !key.meta) {
        store.setState((s) => {
          const updated = [...s.lines];
          updated[s.cursorLine] = (updated[s.cursorLine] ?? "") + cleanInput;
          return {
            lines: updated,
            dropdownIndex: 0,
            dropdownDismissed: false,
          };
        });
      }
    });
    return off;
  }, []);

  return (data) => {
    const lines = Array.isArray(data.lines)
      ? data.lines.filter((line): line is string => typeof line === "string")
      : [""];
    const cursorLine = intArg(data, "cursorLine", 0);
    const dropdownIndex = intArg(data, "dropdownIndex", 0);
    const dropdownDismissed = boolArg(data, "dropdownDismissed", false);
    const cursorVisible = boolArg(data, "cursorVisible", true);
    const isMultiline = lines.length > 1;

    const first = lines[0];
    let filteredCmds: Command[] = [];
    let recentCount = 0;

    if (first.startsWith("/") && !isMultiline) {
      const query = first.slice(1).toLowerCase();
      if (!query.includes(" ")) {
        if (!query) {
          if (!usageTracker) {
            filteredCmds = commands;
          } else {
            const recentNames = new Set(usageTracker.getRecentlyUsed(5));
            const recent = commands.filter((c) => recentNames.has(c.name));
            const rest = commands.filter((c) => !recentNames.has(c.name));
            filteredCmds = [...recent, ...rest];
            recentCount = recent.length;
          }
        } else {
          const seen = new Set<string>();
          const result: Command[] = [];
          const add = (cmd: Command) => {
            if (!seen.has(cmd.name)) {
              seen.add(cmd.name);
              result.push(cmd);
            }
          };

          for (const c of commands) {
            if (c.name.toLowerCase() === query) {
              add(c);
            }
          }
          for (const c of commands) {
            if (c.aliases.some((a) => a.toLowerCase() === query)) {
              add(c);
            }
          }
          for (const c of commands) {
            if (c.name.toLowerCase().startsWith(query)) {
              add(c);
            }
          }
          for (const c of commands) {
            if (c.aliases.some((a) => a.toLowerCase().startsWith(query))) {
              add(c);
            }
          }

          filteredCmds = result;
        }
      }
    }

    const showDropdown =
      filteredCmds.length > 0 && first.startsWith("/") && !isMultiline && !dropdownDismissed;

    let atQuery: string | null = null;
    if (!first.startsWith("/")) {
      const line = lines[cursorLine] ?? "";
      const m = /(?:^|\s)@([^\s]*)$/.exec(line);
      atQuery = m ? m[1] : null;
    }

    let filteredFiles: string[] = [];
    if (atQuery !== null) {
      fileCache ??= scanWorkdirFiles(workDir);
      const q = atQuery.toLowerCase();
      if (!q) {
        filteredFiles = fileCache.slice(0, 8);
      } else {
        const pre = fileCache.filter((f) => f.toLowerCase().startsWith(q));
        const sub = fileCache.filter(
          (f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q),
        );
        filteredFiles = [...pre, ...sub].slice(0, 8);
      }
    }

    const showAtDropdown = !showDropdown && atQuery !== null && filteredFiles.length > 0;

    const borderColor = BORDER_COLORS[inputState];

    let ghostText = "";
    if (!isMultiline && first.startsWith("/") && first.length > 1) {
      const typed = first.slice(1).toLowerCase();
      const best = filteredCmds[0];
      if (best.name.toLowerCase().startsWith(typed)) {
        ghostText = best.name.slice(typed.length);
      }
    }

    const inputBox = Box({
      borderStyle: "round",
      borderTop: true,
      borderBottom: true,
      borderLeft: false,
      borderRight: false,
      borderColor,
      children: [
        Text({
          children: [
            COLORS.primary(`${ICONS.prompt} `),
            disabled
              ? Text({ dimColor: true, children: "Waiting..." })
              : Text({
                  children: [
                    ...lines.map((line, i) =>
                      Text({
                        id: String(i),
                        children: [i > 0 ? "\n  " : "", line],
                      }),
                    ),
                    ghostText ? Text({ dimColor: true, children: ghostText }) : null,
                    cursorVisible ? Text({ inverse: true, children: " " }) : null,
                  ].filter((c): c is VDomNode => c !== null && typeof c !== "string"),
                }),
          ],
        }),
      ],
    });

    const children: VDomNode[] = [inputBox];

    if (showDropdown) {
      const dropdownItems: VDomNode[] = [];
      if (recentCount > 0) {
        dropdownItems.push(Text({ dimColor: true, children: "RECENTLY USED" }));
      }
      filteredCmds.slice(0, 8).forEach((cmd, i) => {
        const icon = CMD_COLOR_MAP[cmd.type] ?? CMD_COLORS.prompt;
        const selected = i === dropdownIndex;
        if (recentCount > 0 && i === recentCount) {
          dropdownItems.push(Text({ dimColor: true, children: "ALL COMMANDS" }));
        }
        dropdownItems.push(
          selected
            ? Text({
                color: "#b4befe",
                children: `${icon} /${cmd.name} ${cmd.description}`,
              })
            : Text({
                dimColor: true,
                children: `${icon} /${cmd.name} ${cmd.description}`,
              }),
        );
      });
      children.push(Box({ children: dropdownItems }));
    }

    if (showAtDropdown) {
      const fileItems: VDomNode[] = [Text({ dimColor: true, children: "FILES" })];
      filteredFiles.forEach((file, i) => {
        fileItems.push(
          Text({
            id: file,
            ...(i === dropdownIndex ? { color: "#b4befe" } : { dimColor: true }),
            children: `${ICONS.arrow} @${file}`,
          }),
        );
      });
      children.push(Box({ children: fileItems }));
    }

    children.push(
      Box({
        paddingLeft: 1,
        children:
          permMode !== "default"
            ? [
                Text({
                  children: [
                    Text({
                      color: permMode in MODEL_DISPLAY ? MODEL_DISPLAY[permMode].color : "gray",
                      children:
                        (permMode in MODEL_DISPLAY ? MODEL_DISPLAY[permMode].name : permMode) +
                        " on",
                    }),
                    Text({
                      dimColor: true,
                      children: " (shift+tab to cycle)",
                    }),
                  ],
                }),
              ]
            : [Text({ dimColor: true, children: "default" })],
      }),
    );

    return Box({ children });
  };
});
