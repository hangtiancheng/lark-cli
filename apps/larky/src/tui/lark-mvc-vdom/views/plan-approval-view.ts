import { z } from "zod";
import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { strArg } from "../../../utils/index.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createInputStore } from "../stores/input-store.js";
import { keyboard } from "../runtime/keyboard-input.js";

export type PlanChoice = "yolo" | "manual" | "feedback";

type OnSelectCallback = (choice: PlanChoice, feedback?: string) => void;

const OnSelectCallbackSchema = z.custom<OnSelectCallback>(
  (v): v is OnSelectCallback => typeof v === "function",
);

const PLAN_APPROVAL_OPTIONS = [
  "Yes, enter YOLO mode (auto-approve all)",
  "Yes, manually approve edits",
  "Tell Larky what to change",
];

export const PlanApprovalView = defineTerminalView((_ctx, props?: Record<string, unknown>) => {
  const onSelectResult = OnSelectCallbackSchema.safeParse(props?.onSelect);
  const onSelect: OnSelectCallback = onSelectResult.success
    ? onSelectResult.data
    : (_c: PlanChoice, _f?: string) => {
        /* noop */
      };

  const inputStore = createInputStore();

  tuiUseStore(inputStore, (s) => ({
    value: s.value,
    cursor: s.cursor,
  }));

  let selectedOption = 0;

  tuiUseEffect(() => {
    const off = keyboard.on((input, key) => {
      if (key.upArrow && selectedOption > 0) {
        selectedOption--;
      } else if (key.downArrow && selectedOption < 2) {
        selectedOption++;
      } else if (key.return) {
        if (selectedOption === 0) {
          onSelect("yolo");
        } else if (selectedOption === 1) {
          onSelect("manual");
        } else if (selectedOption === 2) {
          const state = inputStore.getState();
          if (state.value.trim()) {
            onSelect("feedback", state.value);
          }
        }
      } else if (key.escape) {
        onSelect("manual");
      } else if (key.tab && key.shift && selectedOption === 2) {
        const state = inputStore.getState();
        if (state.value.trim()) {
          onSelect("feedback", state.value);
        }
      } else if (selectedOption === 2) {
        const { deleteChar, insertChar } = inputStore.getState();
        if (key.backspace) {
          deleteChar("back");
        } else if (input && !key.ctrl && !key.meta) {
          insertChar(input);
        }
      }
    });
    return off;
  }, []);

  return (data) => {
    const feedbackText = strArg(data, "value", "");

    const options = PLAN_APPROVAL_OPTIONS.map((label, i) => {
      const isActive = i === selectedOption;
      return Text({
        id: String(i),
        children: [
          isActive ? Text({ bold: true, color: "cyan", children: "> " }) : "  ",
          Text({ dimColor: !isActive, children: `${String(i + 1)}. ${label}` }),
        ],
      });
    });

    const children: VDomNode[] = [
      Text({
        bold: true,
        color: "magenta",
        children: "Larky has written up a plan and is ready to execute. Would you like to proceed?",
      }),
      Box({ paddingTop: 1, children: options }),
    ];

    if (selectedOption === 2) {
      children.push(
        Box({
          paddingLeft: 4,
          children: [
            Text({
              children: feedbackText
                ? feedbackText
                : Text({ dimColor: true, children: "Type feedback here..." }),
            }),
            Text({ children: "|" }),
            Text({ dimColor: true, children: "shift+tab to approve with this feedback" }),
          ],
        }),
      );
    }

    return Box({
      paddingTop: 1,
      children,
    });
  };
});
