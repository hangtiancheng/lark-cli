import { z } from "zod";
import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { strArg, intArg } from "@/utils/index.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createDialogStore } from "../stores/dialog-store.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { keyboard } from "../runtime/keyboard-input.js";

export type PermissionAction = "allow" | "deny" | "allowAlways";

const PERMISSION_OPTIONS: { label: string; action: PermissionAction }[] = [
  { label: "Yes", action: "allow" },
  { label: "Yes, and don't ask again for this pattern", action: "allowAlways" },
  { label: "No", action: "deny" },
];

interface PermissionDialogProps {
  toolName: string;
  argsSummary: string;
  reason: string;
  onComplete: (action: PermissionAction) => void;
}

const OnCompleteCallbackSchema = z.custom<PermissionDialogProps["onComplete"]>(
  (v): v is PermissionDialogProps["onComplete"] => typeof v === "function",
);

function noopCallback(_action: PermissionAction): void {
  // intentionally empty
}

export const PermissionDialogView = defineTerminalView((ctx, props?: Record<string, unknown>) => {
  const toolName = props !== undefined ? strArg(props, "toolName") : "";
  const argsSummary = props !== undefined ? strArg(props, "argsSummary") : "";
  const rawOnComplete = props?.onComplete;
  const onCompleteResult = OnCompleteCallbackSchema.safeParse(rawOnComplete);
  const onComplete: PermissionDialogProps["onComplete"] = onCompleteResult.success
    ? onCompleteResult.data
    : noopCallback;

  const store = createDialogStore(PERMISSION_OPTIONS.length);

  tuiUseStore(store, (s) => ({
    cursor: s.cursor,
    isSubmitted: s.isSubmitted,
  }));

  tuiUseEffect(() => {
    const off = keyboard.on((_input, key) => {
      const state = store.getState();
      if (key.upArrow) {
        const next = state.cursor - 1;
        if (next >= 0) {
          store.setState({ cursor: next });
        }
      } else if (key.downArrow) {
        const next = state.cursor + 1;
        if (next < PERMISSION_OPTIONS.length) {
          store.setState({ cursor: next });
        }
      } else if (key.return) {
        onComplete(PERMISSION_OPTIONS[state.cursor].action);
      } else if (key.escape) {
        onComplete("deny");
      }
    });
    return off;
  }, []);

  return (data) => {
    const cursor = intArg(data, "cursor", 0);

    const truncatedArgs =
      argsSummary.length > 120 ? argsSummary.slice(0, 120) + "..." : argsSummary;

    const options = PERMISSION_OPTIONS.map((opt, i) => {
      const isActive = i === cursor;
      return Text({
        id: opt.label,
        children: [
          isActive ? COLORS.tool(` ${ICONS.prompt} `) : "   ",
          isActive
            ? Text({ color: "cyan", children: `${String(i + 1)}. ${opt.label}` })
            : Text({ dimColor: true, children: `${String(i + 1)}. ${opt.label}` }),
        ],
      });
    });

    const children: VDomNode[] = [
      Text({ bold: true, children: COLORS.warning(`  ${toolName} command`) }),
    ];

    if (argsSummary) {
      children.push(Text({ children: " " }));
      children.push(Text({ dimColor: true, children: truncatedArgs }));
    }

    children.push(Text({ dimColor: true, children: " This command requires approval" }));
    children.push(Text({ children: " Do you want to proceed?" }));
    children.push(...options);
    children.push(Text({ children: " " }));

    return Box({
      paddingLeft: 1,
      paddingTop: 1,
      children,
    });
  };
});
