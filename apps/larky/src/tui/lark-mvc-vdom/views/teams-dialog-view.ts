import { z } from "zod";
import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createSimpleStore as createStore } from "../stores/create-store.js";
import { keyboard } from "../runtime/keyboard-input.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { formatTokens } from "../../../teams/progress.js";
import { intArg, strArg } from "@/utils/index.js";

const ToolActivityItemSchema = z.object({
  activityDescription: z.string(),
});

const AgentProgressItemSchema = z.object({
  toolUseCount: z.number(),
  tokenCount: z.number(),
  recentActivities: z.array(ToolActivityItemSchema),
});

const TeammateItemSchema = z.object({
  name: z.string(),
  teamName: z.string(),
  status: z.enum(["running", "idle", "completed", "failed", "stopped"]),
  startTime: z.number(),
  progress: AgentProgressItemSchema,
  lastMessage: z.string().optional(),
});

type TeammateItem = z.infer<typeof TeammateItemSchema>;

const TeammateArraySchema = z.array(TeammateItemSchema);

const KillHandlerSchema = z.custom<(name: string, teamName: string) => void>(
  (v): v is (name: string, teamName: string) => void => typeof v === "function",
);

const CloseHandlerSchema = z.custom<() => void>((v): v is () => void => typeof v === "function");

type KillHandler = (name: string, teamName: string) => void;
type CloseHandler = () => void;

interface TeamsState {
  selectedIndex: number;
  view: "list" | "detail";
  detailName: string | null;
}

function formatElapsed(startTime: number): string {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  if (secs < 60) {
    return `${String(secs)}s`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${String(mins)}m${String(secs % 60)}s`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h${String(mins % 60)}m`;
}

function statusColor(status: TeammateItem["status"]): string {
  switch (status) {
    case "running":
      return "green";
    case "idle":
      return "yellow";
    case "completed":
      return "cyan";
    case "failed":
      return "red";
    case "stopped":
      return "gray";
  }
}

function noopClose(): void {
  // intentionally empty
}

export const TeamsDialogView = defineTerminalView((_ctx, props?: Record<string, unknown>) => {
  const propsSafe = props ?? {};

  const teammatesRaw = propsSafe.teammates;
  const teammatesResult = TeammateArraySchema.safeParse(teammatesRaw);
  const teammates: TeammateItem[] = teammatesResult.success ? teammatesResult.data : [];

  const onCloseRaw = propsSafe.onClose;
  const onCloseResult = CloseHandlerSchema.safeParse(onCloseRaw);
  const onClose: CloseHandler = onCloseResult.success ? onCloseResult.data : noopClose;

  const onKillRaw = propsSafe.onKill;
  const onKillResult = KillHandlerSchema.safeParse(onKillRaw);
  const onKill: KillHandler | undefined = onKillResult.success ? onKillResult.data : undefined;

  const onShutdownRaw = propsSafe.onShutdown;
  const onShutdownResult = KillHandlerSchema.safeParse(onShutdownRaw);
  const onShutdown: KillHandler | undefined = onShutdownResult.success
    ? onShutdownResult.data
    : undefined;

  const store = createStore<TeamsState>({
    selectedIndex: 0,
    view: "list",
    detailName: null,
  });

  tuiUseStore(store);

  tuiUseEffect(() => {
    const off = keyboard.on((input, key) => {
      const state = store.getState();

      if (state.view === "detail") {
        if (key.escape || key.leftArrow) {
          store.setState({ view: "list", detailName: null });
          return;
        }
        const mate = teammates.find((t) => t.name === state.detailName);
        if (!mate) {
          return;
        }
        if (input === "k" && onKill) {
          onKill(mate.name, mate.teamName);
        } else if (input === "s" && onShutdown) {
          onShutdown(mate.name, mate.teamName);
        }
        return;
      }

      if (key.escape) {
        onClose();
      } else if (key.upArrow) {
        store.setState((s) => ({
          selectedIndex: s.selectedIndex > 0 ? s.selectedIndex - 1 : teammates.length - 1,
        }));
      } else if (key.downArrow) {
        store.setState((s) => ({
          selectedIndex: s.selectedIndex < teammates.length - 1 ? s.selectedIndex + 1 : 0,
        }));
      } else if (key.return && teammates.length > 0) {
        const st = store.getState();
        const clampedIndex = Math.min(st.selectedIndex, teammates.length - 1);
        const mate = teammates[clampedIndex];
        store.setState({ detailName: mate.name, view: "detail" });
      } else if (input === "k" && onKill && teammates.length > 0) {
        const st = store.getState();
        const clampedIndex = Math.min(st.selectedIndex, teammates.length - 1);
        const mate = teammates[clampedIndex];
        onKill(mate.name, mate.teamName);
      } else if (input === "s" && onShutdown && teammates.length > 0) {
        const st = store.getState();
        const clampedIndex = Math.min(st.selectedIndex, teammates.length - 1);
        const mate = teammates[clampedIndex];
        onShutdown(mate.name, mate.teamName);
      }
    });
    return off;
  }, []);

  return (data: Record<string, unknown>) => {
    const selectedIndex = intArg(data, "selectedIndex", 0);
    const view = strArg(data, "view", "list");
    const detailNameRaw = data.detailName;
    const detailName = typeof detailNameRaw === "string" ? detailNameRaw : null;

    if (teammates.length === 0) {
      return Box({
        paddingLeft: 1,
        paddingTop: 1,
        children: [
          Text({ children: COLORS.primary("━━━ Teams ━━━━━━━━━━━━━━━━━━━━━━━━") }),
          Text({ children: " " }),
          Text({ dimColor: true, children: " No active teammates" }),
          Text({ children: " " }),
          Text({ children: COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") }),
          Text({ dimColor: true, children: "Esc close" }),
        ],
      });
    }

    if (view === "detail" && detailName) {
      const mate = teammates.find((t) => t.name === detailName);
      if (!mate) {
        store.setState({ view: "list", detailName: null });
        return Box({ children: [] });
      }

      const elapsed = formatElapsed(mate.startTime);
      const tools = mate.progress.toolUseCount;
      const tokens = formatTokens(mate.progress.tokenCount);
      const toolLabel = tools === 1 ? "tool" : "tools";
      const activities = mate.progress.recentActivities;

      const children: VDomNode[] = [
        Text({ children: COLORS.primary(`━━━ @${mate.name} ━━━━━━━━━━━━━━━━━━━━━━━`) }),
        Text({ children: " " }),
        Text({
          children: [
            "  Status: ",
            Text({ color: statusColor(mate.status), children: mate.status }),
            ` ${ICONS.dot} ${elapsed} ${ICONS.dot} ${String(tools)} ${toolLabel} ${ICONS.dot} ${tokens} tokens`,
          ],
        }),
        Text({ children: " " }),
      ];

      if (activities.length > 0) {
        children.push(Text({ dimColor: true, children: " Recent activity:" }));
        const activityItems: VDomNode[] = activities.map((act, i) => {
          const isLast = i === activities.length - 1;
          const prefix = isLast ? `  ${ICONS.prompt} ` : "    ";
          return Text({
            id: String(i),
            children: [
              isLast ? COLORS.tool(prefix) : Text({ dimColor: true, children: prefix }),
              Text({
                ...(isLast ? { color: "cyan" } : { dimColor: true }),
                children: act.activityDescription,
              }),
            ],
          });
        });
        children.push(...activityItems);
      } else {
        children.push(Text({ dimColor: true, children: " No recent activity" }));
      }

      if (mate.lastMessage) {
        children.push(Text({ children: " " }));
        children.push(Text({ dimColor: true, children: " Last message:" }));
        const truncated =
          mate.lastMessage.length > 80 ? `${mate.lastMessage.slice(0, 80)}...` : mate.lastMessage;
        children.push(Text({ children: `  ${truncated}` }));
      }

      children.push(Text({ children: " " }));
      children.push(Text({ children: COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") }));
      children.push(
        Text({ dimColor: true, children: "  ← back · k kill · s shutdown · Esc close" }),
      );

      return Box({
        paddingLeft: 1,
        paddingTop: 1,
        children,
      });
    }

    const clampedIndex = Math.min(selectedIndex, teammates.length - 1);
    const listItems = teammates.map((mate, i) => {
      const isSelected = i === clampedIndex;
      const indicator = isSelected ? COLORS.tool(`${ICONS.prompt} `) : "  ";
      const tools = mate.progress.toolUseCount;
      const tokens = formatTokens(mate.progress.tokenCount);
      const toolLabel = tools === 1 ? "tool" : "tools";
      return Text({
        id: mate.name,
        children: [
          indicator,
          Text({
            ...(isSelected ? { color: "cyan" } : { dimColor: true }),
            children: `@${mate.name}`,
          }),
          Text({
            dimColor: !isSelected,
            children: [
              " (",
              Text({ color: statusColor(mate.status), children: mate.status }),
              `) ${ICONS.dot} ${String(tools)} `,
              `${toolLabel} ${ICONS.dot} ${tokens} tokens`,
            ],
          }),
        ],
      });
    });

    return Box({
      paddingLeft: 1,
      paddingTop: 1,
      children: [
        Text({ children: COLORS.primary("━━━ Teams ━━━━━━━━━━━━━━━━━━━━━━━━") }),
        Text({ children: " " }),
        ...listItems,
        Text({ children: " " }),
        Text({ children: COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") }),
        Text({
          dimColor: true,
          children: "  ↑/↓ select · Enter detail · k kill · s shutdown · Esc close",
        }),
      ],
    });
  };
});
