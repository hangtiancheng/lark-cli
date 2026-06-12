import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import type { CodegenType } from "../engine/codegen-type.js";
import type { ParsedProject } from "../engine/project/index.js";
import { parseGeneratedCode } from "../engine/project/index.js";
import type {
  ChatMessage,
  CodegenWorkflow,
  WorkflowEvent,
  WorkflowStep,
} from "../engine/workflow/index.js";

export type WorkflowPhase = "idle" | "running" | "done" | "error" | "confirming";

export type WorkflowUiState = {
  phase: WorkflowPhase;
  completedSteps: WorkflowStep[];
  currentStep?: WorkflowStep;
  streamedCode: string;
  outputDir?: string;
  errorMessage?: string;
  parsedProject?: ParsedProject;
  codegenType?: CodegenType;
  history: ChatMessage[];
};

export const useCodegenWorkflow = (workflow: CodegenWorkflow) => {
  const [state, setState] = useState<WorkflowUiState>({
    phase: "idle",
    completedSteps: [],
    streamedCode: "",
    history: [],
  });
  const abortRef = useRef(false);

  const run = useCallback(
    async (input: Parameters<CodegenWorkflow["execute"]>[0]) => {
      abortRef.current = false;
      setState((prev) => ({
        phase: "running" as const,
        completedSteps: [],
        streamedCode: "",
        codegenType: input.codegenType,
        history: prev.history,
      }));

      try {
        for await (const event of workflow.execute(input)) {
          if (abortRef.current) break;
          handleEvent(event, setState, input.codegenType);
        }
      } catch (err) {
        setState((prev) => ({
          ...prev,
          phase: "error" as const,
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [workflow],
  );

  const resetForFollowUp = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: "idle" as const,
      completedSteps: [],
      currentStep: undefined,
      streamedCode: "",
      errorMessage: undefined,
      parsedProject: undefined,
    }));
  }, []);

  return { state, run, resetForFollowUp };
};

function handleEvent(
  event: WorkflowEvent,
  setState: Dispatch<SetStateAction<WorkflowUiState>>,
  codegenType: CodegenType,
) {
  switch (event.event) {
    case "step-complete":
      setState((prev) => ({
        ...prev,
        completedSteps: [...prev.completedSteps, event.data.step],
        currentStep: undefined,
      }));
      break;
    case "chunk":
      setState((prev) => ({
        ...prev,
        currentStep: "codegen",
        streamedCode: prev.streamedCode + event.data.d,
      }));
      break;
    case "business-error":
      setState((prev) => ({
        ...prev,
        phase: "error" as const,
        errorMessage: event.data.message,
      }));
      break;
    case "done": {
      const outputDir = event.data.outputDir;
      const history = event.data.history;
      setState((prev) => {
        let parsedProject: ParsedProject | undefined;
        try {
          parsedProject = parseGeneratedCode(prev.streamedCode, codegenType);
        } catch {}
        return {
          ...prev,
          phase: "confirming" as const,
          outputDir,
          parsedProject,
          history: history ?? prev.history,
        };
      });
      break;
    }
  }
}
