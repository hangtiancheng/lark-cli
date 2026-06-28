import type { Question } from "@/tools/ask-user.js";
import { useCallback, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS, ICONS } from "./styles.js";

const OTHER = "Other (type your own)";

interface Props {
  questions: Question[];
  onComplete: (answer: Record<string, string>) => void;
}

// Per-question UI state preserved across tab switches.
interface QuestionState {
  cursor: number;
  selected: Set<number>;
  otherText: string;
  otherMode: boolean;
  /** The committed answer string, undefined until user picks one. */
  answer: string | undefined;
}

const INITIAL_QUESTION_STATE: QuestionState = {
  cursor: 0,
  selected: new Set<number>(),
  otherText: "",
  otherMode: false,
  answer: undefined,
};

function AskUserDialog(props: Props) {
  const { questions, onComplete } = props;
  // Tab index
  // 0..questions.length-1 = Question tabs
  // questions.length = Submit tab
  const [curTabIdx, setCurTabIdx] = useState(0);

  const [questionStates, setQuestionStates] = useState<QuestionState[]>(() =>
    Array.from({ length: questions.length }, () => ({
      ...INITIAL_QUESTION_STATE,
    })),
  );

  // Ref keeps currentTab fresh for callbacks that outlive a render cycle.
  const curTabIdxRef = useRef(curTabIdx);
  // currentTabRef.current = currentTab;

  // const isSubmitTab = useMemo(
  //   () => curTabIdx === questions.length,
  //   [curTabIdx, questions.length],
  // );
  const isSubmitTab = curTabIdx === questions.length;

  // const curQuestion = useMemo(
  //   () => (isSubmitTab ? undefined : questions[curTabIdx]),
  //   [isSubmitTab, questions, curTabIdx],
  // );
  const curQuestion = isSubmitTab ? undefined : questions[curTabIdx];

  // const curQuestionState = useMemo(
  //   () => (isSubmitTab ? undefined : questionStates[curTabIdx]),
  //   [isSubmitTab, questionStates, curTabIdx],
  // );
  const curQuestionState = isSubmitTab ? undefined : questionStates[curTabIdx];

  // Whether all questions have an answer (enables Submit).
  const allAnswered = questionStates.every((s) => s.answer !== undefined);

  type Updater = (qs: QuestionState) => QuestionState;

  // Helpers to update per-question state immutably.
  const updateCurrent = useCallback((updater: Updater) => {
    setQuestionStates((prev) => {
      const idx = curTabIdxRef.current;
      const newStates = [...prev];
      newStates[idx] = updater(newStates[idx]);
      return newStates;
    });
  }, []);

  const commitAnswer = useCallback(
    (answer: string) => {
      updateCurrent((qs) => ({
        ...qs,
        answer,
        otherMode: false,
      }));
    },
    [updateCurrent],
  );

  const switchTab = useCallback(
    (delta: number) => {
      const totalTabCount = questions.length + 1; // +1 for Submit
      setCurTabIdx((tabIdx) => {
        let newTabIdx = tabIdx + delta;
        if (newTabIdx < 0) {
          newTabIdx = totalTabCount - 1;
        }
        if (newTabIdx >= totalTabCount) {
          newTabIdx = 0;
        }
        return newTabIdx;
      });
    },
    [questions.length],
  );

  useInput((input, key) => {
    // ------ other-text typing mode (scoped to the current question) ------
    if (!isSubmitTab && curQuestionState?.otherMode) {
      if (key.return) {
        commitAnswer(curQuestionState.otherText.trim() || "(no answer)");
      } else if (key.backspace || key.delete) {
        updateCurrent((qs) => ({
          ...qs,
          otherText: qs.otherText.slice(0, -1),
        }));
      } else if (key.escape) {
        updateCurrent((qs) => ({ ...qs, otherMode: false }));
      } else if (input && !key.ctrl && !key.meta) {
        updateCurrent((qs) => ({ ...qs, otherText: qs.otherText + input }));
      }
      return;
    }

    // ------ global: escape cancels entire dialog ------
    if (key.escape) {
      onComplete({});
      return;
    }

    // ------ tab navigation: left/right arrows, Tab / Shift+Tab ------
    if (key.leftArrow) {
      switchTab(-1);
      return;
    }
    if (key.rightArrow) {
      switchTab(1);
      return;
    }
    if (key.tab) {
      switchTab(key.shift ? -1 : 1);
      return;
    }

    // ------ Submit tab ------
    if (isSubmitTab) {
      if (key.return && allAnswered) {
        const answers: Record<string, string> = {};
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i].question;
          answers[q] = questionStates[i].answer ?? "";
        }
        onComplete(answers);
      }
      return;
    }

    // ------ Question tab: up/down, space, enter ------
    if (!curQuestion || !curQuestionState) {
      return;
    }
    const rows = [...curQuestion.options.map((o) => o.label), OTHER];

    if (key.upArrow) {
      updateCurrent((s) => ({
        ...s,
        cursor: s.cursor > 0 ? s.cursor - 1 : rows.length - 1,
      }));
    } else if (key.downArrow) {
      updateCurrent((s) => ({
        ...s,
        cursor: s.cursor < rows.length - 1 ? s.cursor + 1 : 0,
      }));
    } else if (
      input === " " &&
      curQuestion.multiSelect &&
      curQuestionState.cursor < curQuestion.options.length
    ) {
      updateCurrent((s) => {
        const newSelected = new Set(s.selected);
        if (newSelected.has(s.cursor)) {
          newSelected.delete(s.cursor);
        } else {
          newSelected.add(s.cursor);
        }
        return { ...s, selected: newSelected };
      });
    } else if (key.return) {
      if (curQuestionState.cursor === rows.length - 1) {
        updateCurrent((s) => ({ ...s, otherMode: true }));
        return;
      }
      if (curQuestion.multiSelect && curQuestionState.selected.size > 0) {
        const answer = [...curQuestionState.selected]
          .sort((a, b) => a - b)
          .map((i) => curQuestion.options[i].label)
          .join(", ");
        commitAnswer(answer);
      } else {
        commitAnswer(curQuestion.options[curQuestionState.cursor]?.label ?? "(unknown)");
      }
    }
  });

  // ===================== Render =====================

  const renderTabBar = () => {
    const tabs: React.ReactNode[] = [];

    tabs.push(
      <Text key="left-arrow" dimColor>
        {"  ← "}
      </Text>,
    );

    for (let i = 0; i < questions.length; i++) {
      const isActive = curTabIdx === i;
      const hasAnswer = questionStates[i].answer !== undefined;
      const label = questions[i].header;
      tabs.push(
        <Text key={`tab-${String(i)}`}>
          {isActive ? (
            <Text bold color="cyan">
              {"["}
              {label}
              {"]"}
            </Text>
          ) : hasAnswer ? (
            <Text color="green">
              {"["}
              {ICONS.success} {label}
              {"]"}
            </Text>
          ) : (
            <Text dimColor>
              {"["}
              {label}
              {"]"}
            </Text>
          )}{" "}
        </Text>,
      );
    }

    // Submit tab
    const submitActive = isSubmitTab;
    tabs.push(
      <Text key="submit-tab">
        {submitActive ? (
          <Text bold color={allAnswered ? "cyan" : ""} dimColor={!allAnswered}>
            {"[Submit]"}
          </Text>
        ) : (
          <Text dimColor>{"[Submit]"}</Text>
        )}
      </Text>,
    );

    tabs.push(
      <Text key="right-arrow" dimColor>
        {" "}
        {ICONS.arrow}
      </Text>,
    );

    return <Box>{tabs}</Box>;
  };

  const renderQuestion = () => {
    if (!curQuestion || !curQuestionState) {
      return null;
    }
    const rows = [...curQuestion.options.map((opt) => opt.label), OTHER];

    return (
      <>
        <Text>
          {COLORS.tool(`  [${curQuestion.header}]`)}
          <Text dimColor>{`  (Q${String(curTabIdx + 1)}/${String(questions.length)})`}</Text>
        </Text>{" "}
        <Text bold>{`  ${curQuestion.question}`}</Text>
        {curQuestion.multiSelect && <Text dimColor> (space to toggle, enter to confirm)</Text>}
        {curQuestionState.answer !== undefined && (
          <Text>
            {"  "}
            <Text color="green">
              {ICONS.success} answered: {curQuestionState.answer}
            </Text>
            <Text dimColor> (press Enter to change)</Text>
          </Text>
        )}{" "}
        {rows.map((label, i) => {
          const isOther = i === rows.length - 1;
          const checked = curQuestion.multiSelect && !isOther && curQuestionState.selected.has(i);
          const mark = curQuestion.multiSelect && !isOther ? (checked ? "[x] " : "[ ] ") : "";
          const desc = !isOther ? curQuestion.options[i]?.description : undefined;
          return (
            <Text key={label}>
              {i === curQuestionState.cursor ? COLORS.tool(` ${ICONS.prompt} `) : "   "}
              <Text
                color={i === curQuestionState.cursor ? "cyan" : ""}
                dimColor={i !== curQuestionState.cursor}
              >
                {`${mark}${label}`}
                {desc ? ` — ${desc}` : ""}
              </Text>
            </Text>
          );
        })}
        {curQuestionState.otherMode && (
          <>
            {" "}
            <Text>
              {"  > "}
              <Text color="cyan">{curQuestionState.otherText}</Text>
              <Text dimColor>|</Text>
            </Text>
          </>
        )}
      </>
    );
  };

  const renderSubmitPanel = () => {
    return (
      <>
        <Text bold>{allAnswered ? "  Review your answers:" : "  Answer all questions first"}</Text>{" "}
        {questions.map((qn, i) => {
          const questionState = questionStates[i];
          return (
            <Text key={qn.question}>
              {"  "}
              {questionState.answer !== undefined ? (
                <Text color="green">{ICONS.success}</Text>
              ) : (
                <Text dimColor>{"○"}</Text>
              )}
              <Text>
                {" "}
                <Text bold>{qn.header}</Text>
                {": "}
                {questionState.answer !== undefined ? (
                  <Text>{questionState.answer}</Text>
                ) : (
                  <Text dimColor>(not answered)</Text>
                )}
              </Text>
            </Text>
          );
        })}{" "}
        {allAnswered ? (
          <Text color="cyan" bold>
            {"  Press Enter to submit, or ←/→ to review questions"}
          </Text>
        ) : (
          <Text dimColor>{"  Use ←/→ or Tab to navigate to unanswered questions"}</Text>
        )}
      </>
    );
  };

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      {isSubmitTab ? renderSubmitPanel() : renderQuestion()} {renderTabBar()}
      <Text dimColor> ←/→ or Tab: switch questions Esc: cancel</Text>{" "}
    </Box>
  );
}

export default AskUserDialog;
