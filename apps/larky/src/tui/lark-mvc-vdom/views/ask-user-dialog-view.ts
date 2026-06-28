import { z } from "zod";
import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { intArg } from "@/utils/index.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createSimpleStore as createStore } from "../stores/create-store.js";
import { keyboard } from "../runtime/keyboard-input.js";
import { COLORS, ICONS } from "../utils/styles.js";

const QuestionSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
  multiSelect: z.boolean(),
});

const QuestionArraySchema = z.array(QuestionSchema);

interface Question {
  header: string;
  question: string;
  options: { label: string; description?: string | undefined }[];
  multiSelect: boolean;
}

interface QuestionState {
  cursor: number;
  selected: Set<number>;
  otherText: string;
  otherMode: boolean;
  answer?: string | undefined;
}

interface AskUserState {
  curTabIdx: number;
  questionStates: QuestionState[];
}

const OTHER = "Other (type your own)";

const noopOnComplete = (): void => {
  // intentionally empty
};

const OnCompleteCallbackSchema = z.custom<(answer: Record<string, string>) => void>(
  (v): v is (answer: Record<string, string>) => void => typeof v === "function",
);

const QuestionStateSchema = z.object({
  cursor: z.number(),
  selected: z.custom<Set<number>>((v) => v instanceof Set),
  otherText: z.string(),
  otherMode: z.boolean(),
  answer: z.string().optional(),
});

const QuestionStatesArraySchema = z.array(QuestionStateSchema);

function createInitialQuestionState(count: number): QuestionState[] {
  return Array.from({ length: count }, () => ({
    cursor: 0,
    selected: new Set<number>(),
    otherText: "",
    otherMode: false,
  }));
}

export const AskUserDialogView = defineTerminalView((ctx, props?: Record<string, unknown>) => {
  const rawQuestions = props?.questions;
  const questionsResult = QuestionArraySchema.safeParse(rawQuestions);
  const questions: Question[] = questionsResult.success ? questionsResult.data : [];

  const rawOnComplete = props?.onComplete;
  const onCompleteResult = OnCompleteCallbackSchema.safeParse(rawOnComplete);
  const onComplete: (answer: Record<string, string>) => void = onCompleteResult.success
    ? onCompleteResult.data
    : noopOnComplete;

  const store = createStore<AskUserState>({
    curTabIdx: 0,
    questionStates: createInitialQuestionState(questions.length),
  });

  tuiUseStore(store);

  tuiUseEffect(() => {
    const off = keyboard.on((input, key) => {
      const state = store.getState();
      const isSubmitTab = state.curTabIdx === questions.length;
      const curQuestionState = isSubmitTab ? undefined : state.questionStates[state.curTabIdx];

      if (!isSubmitTab && curQuestionState?.otherMode) {
        if (key.return) {
          store.setState((s) => {
            const newStates = [...s.questionStates];
            newStates[s.curTabIdx] = {
              ...newStates[s.curTabIdx],
              answer:
                curQuestionState.otherText.trim() === ""
                  ? "(no answer)"
                  : curQuestionState.otherText.trim(),
              otherMode: false,
            };
            return { questionStates: newStates };
          });
        } else if (key.backspace || key.delete) {
          store.setState((s) => {
            const newStates = [...s.questionStates];
            newStates[s.curTabIdx] = {
              ...newStates[s.curTabIdx],
              otherText: newStates[s.curTabIdx].otherText.slice(0, -1),
            };
            return { questionStates: newStates };
          });
        } else if (key.escape) {
          store.setState((s) => {
            const newStates = [...s.questionStates];
            newStates[s.curTabIdx] = {
              ...newStates[s.curTabIdx],
              otherMode: false,
            };
            return { questionStates: newStates };
          });
        } else if (input && !key.ctrl && !key.meta) {
          store.setState((s) => {
            const newStates = [...s.questionStates];
            newStates[s.curTabIdx] = {
              ...newStates[s.curTabIdx],
              otherText: newStates[s.curTabIdx].otherText + input,
            };
            return { questionStates: newStates };
          });
        }
        return;
      }

      if (key.escape) {
        onComplete({});
        return;
      }

      if (key.leftArrow) {
        store.setState((s) => {
          const totalTabCount = questions.length + 1;
          let newTabIdx = s.curTabIdx - 1;
          if (newTabIdx < 0) {
            newTabIdx = totalTabCount - 1;
          }
          return { curTabIdx: newTabIdx };
        });
        return;
      }

      if (key.rightArrow) {
        store.setState((s) => {
          const totalTabCount = questions.length + 1;
          let newTabIdx = s.curTabIdx + 1;
          if (newTabIdx >= totalTabCount) {
            newTabIdx = 0;
          }
          return { curTabIdx: newTabIdx };
        });
        return;
      }

      if (key.tab) {
        store.setState((s) => {
          const totalTabCount = questions.length + 1;
          const delta = key.shift ? -1 : 1;
          let newTabIdx = s.curTabIdx + delta;
          if (newTabIdx < 0) {
            newTabIdx = totalTabCount - 1;
          }
          if (newTabIdx >= totalTabCount) {
            newTabIdx = 0;
          }
          return { curTabIdx: newTabIdx };
        });
        return;
      }

      if (isSubmitTab) {
        if (key.return) {
          const allAnswered = state.questionStates.every((s) => s.answer !== undefined);
          if (allAnswered) {
            const answers: Record<string, string> = {};
            for (let i = 0; i < questions.length; i++) {
              const q = questions[i].question;
              answers[q] = state.questionStates[i].answer ?? "";
            }
            onComplete(answers);
          }
        }
        return;
      }

      const curQuestion = questions[state.curTabIdx];
      if (!curQuestionState) {
        return;
      }

      const rows = [...curQuestion.options.map((o) => o.label), OTHER];

      if (key.upArrow) {
        store.setState((s) => {
          const newStates = [...s.questionStates];
          const qs = newStates[s.curTabIdx];
          newStates[s.curTabIdx] = {
            ...qs,
            cursor: qs.cursor > 0 ? qs.cursor - 1 : rows.length - 1,
          };
          return { questionStates: newStates };
        });
      } else if (key.downArrow) {
        store.setState((s) => {
          const newStates = [...s.questionStates];
          const qs = newStates[s.curTabIdx];
          newStates[s.curTabIdx] = {
            ...qs,
            cursor: qs.cursor < rows.length - 1 ? qs.cursor + 1 : 0,
          };
          return { questionStates: newStates };
        });
      } else if (
        input === " " &&
        curQuestion.multiSelect &&
        curQuestionState.cursor < curQuestion.options.length
      ) {
        store.setState((s) => {
          const newStates = [...s.questionStates];
          const qs = newStates[s.curTabIdx];
          const newSelected = new Set(qs.selected);
          if (newSelected.has(qs.cursor)) {
            newSelected.delete(qs.cursor);
          } else {
            newSelected.add(qs.cursor);
          }
          newStates[s.curTabIdx] = { ...qs, selected: newSelected };
          return { questionStates: newStates };
        });
      } else if (key.return) {
        if (curQuestionState.cursor === rows.length - 1) {
          store.setState((s) => {
            const newStates = [...s.questionStates];
            newStates[s.curTabIdx] = {
              ...newStates[s.curTabIdx],
              otherMode: true,
            };
            return { questionStates: newStates };
          });
          return;
        }

        let answer: string;
        if (curQuestion.multiSelect && curQuestionState.selected.size > 0) {
          answer = [...curQuestionState.selected]
            .sort((a, b) => a - b)
            .map((i) => curQuestion.options[i].label)
            .join(", ");
        } else {
          answer = curQuestion.options[curQuestionState.cursor]?.label ?? "(unknown)";
        }

        store.setState((s) => {
          const newStates = [...s.questionStates];
          newStates[s.curTabIdx] = {
            ...newStates[s.curTabIdx],
            answer,
            otherMode: false,
          };
          return { questionStates: newStates };
        });
      }
    });
    return off;
  }, []);

  return (data) => {
    const curTabIdx = intArg(data, "curTabIdx", 0);
    const questionStatesRaw = data.questionStates;
    const questionStatesResult = QuestionStatesArraySchema.safeParse(questionStatesRaw);
    const questionStates: QuestionState[] = questionStatesResult.success
      ? questionStatesResult.data
      : [];
    const isSubmitTab = curTabIdx === questions.length;
    const curQuestion = isSubmitTab ? undefined : questions[curTabIdx];
    const curQuestionState = isSubmitTab ? undefined : questionStates[curTabIdx];
    const allAnswered = questionStates.every((s) => s.answer !== undefined);

    const tabBarItems: VDomNode[] = [Text({ dimColor: true, children: "  ← " })];

    for (let i = 0; i < questions.length; i++) {
      const isActive = curTabIdx === i;
      const hasAnswer = questionStates[i].answer !== undefined;
      const label = questions[i].header;
      tabBarItems.push(
        Text({
          id: `tab-${String(i)}`,
          children: [
            isActive
              ? Text({ bold: true, color: "cyan", children: `[${label}]` })
              : hasAnswer
                ? Text({
                    color: "green",
                    children: `[${ICONS.success} ${label}]`,
                  })
                : Text({ dimColor: true, children: `[${label}]` }),
            " ",
          ],
        }),
      );
    }

    tabBarItems.push(
      Text({
        id: "submit-tab",
        children: isSubmitTab
          ? Text({
              bold: true,
              ...(allAnswered ? { color: "cyan" } : { dimColor: true }),
              children: "[Submit]",
            })
          : Text({ dimColor: true, children: "[Submit]" }),
      }),
    );

    tabBarItems.push(Text({ dimColor: true, children: ` ${ICONS.arrow}` }));

    const tabBar = Box({ children: tabBarItems });

    let content: VDomNode[];

    if (isSubmitTab) {
      content = [
        Text({
          bold: true,
          children: allAnswered ? "  Review your answers:" : "  Answer all questions first",
        }),
        Text({ children: " " }),
      ];

      for (let i = 0; i < questions.length; i++) {
        const qn = questions[i];
        const questionState = questionStates[i];
        content.push(
          Text({
            id: qn.question,
            children: [
              "  ",
              questionState.answer !== undefined
                ? Text({ color: "green", children: ICONS.success })
                : Text({ dimColor: true, children: "○" }),
              " ",
              Text({ bold: true, children: qn.header }),
              ": ",
              questionState.answer !== undefined
                ? Text({ children: questionState.answer })
                : Text({ dimColor: true, children: "(not answered)" }),
            ],
          }),
        );
      }

      content.push(Text({ children: " " }));
      content.push(
        allAnswered
          ? Text({
              color: "cyan",
              bold: true,
              children: "  Press Enter to submit, or ←/→ to review questions",
            })
          : Text({
              dimColor: true,
              children: "  Use ←/→ or Tab to navigate to unanswered questions",
            }),
      );
    } else if (curQuestion && curQuestionState) {
      const rows = [...curQuestion.options.map((opt) => opt.label), OTHER];

      content = [
        Text({
          children: [
            COLORS.tool(`  [${curQuestion.header}]`),
            Text({
              dimColor: true,
              children: `  (Q${String(curTabIdx + 1)}/${String(questions.length)})`,
            }),
          ],
        }),
        Text({ children: " " }),
        Text({ bold: true, children: `  ${curQuestion.question}` }),
        ...(curQuestion.multiSelect
          ? [
              Text({
                dimColor: true,
                children: " (space to toggle, enter to confirm)",
              }),
            ]
          : []),
        ...(curQuestionState.answer !== undefined
          ? [
              Text({
                children: [
                  "  ",
                  Text({
                    color: "green",
                    children: `${ICONS.success} answered: ${curQuestionState.answer}`,
                  }),
                  Text({
                    dimColor: true,
                    children: " (press Enter to change)",
                  }),
                ],
              }),
            ]
          : []),
        Text({ children: " " }),
      ];

      const rowItems = rows.map((label, i) => {
        const isOther = i === rows.length - 1;
        const checked = curQuestion.multiSelect && !isOther && curQuestionState.selected.has(i);
        const mark = curQuestion.multiSelect && !isOther ? (checked ? "[x] " : "[ ] ") : "";
        const desc = !isOther ? curQuestion.options[i]?.description : undefined;
        return Text({
          id: label,
          children: [
            i === curQuestionState.cursor ? COLORS.tool(` ${ICONS.prompt} `) : "   ",
            Text({
              ...(i === curQuestionState.cursor ? { color: "cyan" } : { dimColor: true }),
              children: `${mark}${label}${desc ? ` — ${desc}` : ""}`,
            }),
          ],
        });
      });

      content.push(...rowItems.filter(Boolean));

      if (curQuestionState.otherMode) {
        content.push(Text({ children: " " }));
        content.push(
          Text({
            children: [
              "  > ",
              Text({ color: "cyan", children: curQuestionState.otherText }),
              Text({ dimColor: true, children: "|" }),
            ],
          }),
        );
      }
    } else {
      content = [];
    }

    return Box({
      paddingLeft: 1,
      paddingTop: 1,
      children: [
        ...content,
        tabBar,
        Text({
          dimColor: true,
          children: " ←/→ or Tab: switch questions Esc: cancel",
        }),
        Text({ children: " " }),
      ],
    });
  };
});
