import { z } from "zod";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createStore } from "../stores/create-store.js";
import { keyboard } from "../runtime/keyboard-input.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { isRecord } from "@/utils/index.js";

export const RewindActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("code_and_conversation"),
    snapshotIndex: z.number(),
  }),
  z.object({ type: z.literal("conversation_only"), snapshotIndex: z.number() }),
  z.object({ type: z.literal("code_only"), snapshotIndex: z.number() }),
  z.object({ type: z.literal("cancel") }),
]);

export type RewindAction = z.infer<typeof RewindActionSchema>;

const SnapshotSchema = z.object({
  userText: z.string(),
  timestamp: z.string(),
  backups: z.record(z.string(), z.unknown()),
});

type Snapshot = z.infer<typeof SnapshotSchema>;

const SnapshotArraySchema = z.array(SnapshotSchema);

const OnCompleteCallbackSchema = z.custom<(action: RewindAction) => void>(
  (v): v is (action: RewindAction) => void => typeof v === "function",
);
const OnCancelCallbackSchema = z.custom<() => void>(
  (v): v is () => void => typeof v === "function",
);

const RESTORE_OPTIONS = [
  "Restore code and conversation",
  "Restore conversation only",
  "Restore code only",
  "Never mind",
];

interface RewindState {
  phase: 0 | 1;
  cursor: number;
  optionCursor: number;
  selectedIndex: number;
}

function formatAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) {
    return `${String(secs)}s ago`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${String(mins)}m ago`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h ago`;
}

export const RewindDialogView = defineTerminalView((ctx, props?: Record<string, unknown>) => {
  const snapshotsRaw = props?.snapshots;
  const snapshotsResult = SnapshotArraySchema.safeParse(snapshotsRaw);
  const snapshots: Snapshot[] = snapshotsResult.success ? snapshotsResult.data : [];

  const onCompleteResult = OnCompleteCallbackSchema.safeParse(props?.onComplete);
  const onComplete: (action: RewindAction) => void = onCompleteResult.success
    ? onCompleteResult.data
    : (_action: RewindAction) => {
        /* noop */
      };

  const onCancelResult = OnCancelCallbackSchema.safeParse(props?.onCancel);
  const onCancel: () => void = onCancelResult.success
    ? onCancelResult.data
    : () => {
        /* noop */
      };

  const store = createStore<RewindState>("rewind", () => ({
    phase: 0,
    cursor: snapshots.length - 1,
    optionCursor: 0,
    selectedIndex: 0,
  }));

  tuiUseStore(store);

  tuiUseEffect(() => {
    const off = keyboard.on((_input, key) => {
      const state = store.getState();

      if (state.phase === 0) {
        if (key.upArrow) {
          store.setState((s) => ({
            cursor: s.cursor > 0 ? s.cursor - 1 : snapshots.length - 1,
          }));
        } else if (key.downArrow) {
          store.setState((s) => ({
            cursor: s.cursor < snapshots.length - 1 ? s.cursor + 1 : 0,
          }));
        } else if (key.return) {
          store.setState({
            phase: 1,
            selectedIndex: state.cursor,
            optionCursor: 0,
          });
        } else if (key.escape) {
          onCancel();
        }
      } else {
        if (key.upArrow) {
          store.setState((s) => ({
            optionCursor: s.optionCursor > 0 ? s.optionCursor - 1 : RESTORE_OPTIONS.length - 1,
          }));
        } else if (key.downArrow) {
          store.setState((s) => ({
            optionCursor: s.optionCursor < RESTORE_OPTIONS.length - 1 ? s.optionCursor + 1 : 0,
          }));
        } else if (key.return) {
          const state = store.getState();
          switch (state.optionCursor) {
            case 0:
              onComplete({
                type: "code_and_conversation",
                snapshotIndex: state.selectedIndex,
              });
              break;
            case 1:
              onComplete({
                type: "conversation_only",
                snapshotIndex: state.selectedIndex,
              });
              break;
            case 2:
              onComplete({
                type: "code_only",
                snapshotIndex: state.selectedIndex,
              });
              break;
            case 3:
              onComplete({ type: "cancel" });
              break;
          }
        } else if (key.escape) {
          store.setState({ phase: 0 });
        }
      }
    });
    return off;
  }, []);

  return (data) => {
    if (!isRecord(data)) {
      return Box({ children: [Text({ children: "Loading..." })] });
    }
    const phaseValue: 0 | 1 = data.phase === 1 ? 1 : 0;
    const state: RewindState = {
      phase: phaseValue,
      cursor: typeof data.cursor === "number" ? data.cursor : 0,
      optionCursor: typeof data.optionCursor === "number" ? data.optionCursor : 0,
      selectedIndex: typeof data.selectedIndex === "number" ? data.selectedIndex : 0,
    };

    if (state.phase === 0) {
      const snapshotItems = snapshots.map((snap, idx) => {
        const backupsObj = isRecord(snap.backups) ? snap.backups : {};
        const fileCount = Object.keys(backupsObj).length;
        const ago = formatAgo(snap.timestamp);
        const isSelected = idx === state.cursor;
        const userText = typeof snap.userText === "string" ? snap.userText : "(empty)";
        return Box({
          id: String(idx),
          children: [
            Text({
              children: [
                isSelected ? COLORS.primary(`${ICONS.prompt} `) : "  ",
                isSelected ? COLORS.white(`[${String(idx + 1)}]`) : `[${String(idx + 1)}]`,
                ` ${userText}`,
                Text({
                  dimColor: true,
                  children: ` (${ago}, ${String(fileCount)} file(s))`,
                }),
              ],
            }),
          ],
        });
      });

      return Box({
        paddingLeft: 1,
        paddingTop: 1,
        children: [
          Text({
            bold: true,
            children: COLORS.primary("⟲ Rewind to checkpoint"),
          }),
          Text({ children: " " }),
          ...snapshotItems,
          Text({
            dimColor: true,
            children: "\n↑/↓ navigate · enter select · esc cancel",
          }),
        ],
      });
    }

    const snap = snapshots[state.selectedIndex];
    const optionItems = RESTORE_OPTIONS.map((opt, idx) => {
      const isSelected = idx === state.optionCursor;
      return Box({
        id: String(idx),
        children: [
          Text({
            children: [
              isSelected ? COLORS.primary(`${ICONS.prompt} `) : "  ",
              isSelected ? COLORS.white(opt) : opt,
            ],
          }),
        ],
      });
    });

    const userText = typeof snap.userText === "string" ? snap.userText : "(empty)";
    return Box({
      paddingLeft: 1,
      paddingTop: 1,
      children: [
        Text({
          bold: true,
          children: COLORS.primary("⟲ Rewind to checkpoint"),
        }),
        Text({ children: " " }),
        Text({
          dimColor: true,
          children: `Selected: [${String(state.selectedIndex + 1)}] ${userText}`,
        }),
        Text({ children: " " }),
        ...optionItems,
        Text({
          dimColor: true,
          children: "\n↑/↓ navigate · enter select · esc back",
        }),
      ],
    });
  };
});
