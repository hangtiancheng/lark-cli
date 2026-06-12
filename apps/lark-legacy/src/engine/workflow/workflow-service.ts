import { appendImageResourcesToPrompt } from "./image-assets.js";
import { operationErrorEvent, stepEvent, type WorkflowEvent } from "./workflow-events.js";
import { runCodegenAttempts } from "./workflow-codegen-attempts.js";
import { finalizeGeneratedProject } from "./workflow-project-finalizer.js";
import { createInitialWorkflowState, type WorkflowState } from "./workflow-state.js";
import type { CodegenWorkflowDeps, ExecuteWorkflowInput } from "./workflow-types.js";

export const createCodegenWorkflow = (deps: CodegenWorkflowDeps) => {
  const maxAttempts = deps.maxAttempts ?? 2;

  async function* execute(input: ExecuteWorkflowInput): AsyncGenerator<WorkflowEvent> {
    const enhancedInput =
      input.images && input.images.length > 0
        ? { ...input, userPrompt: appendImageResourcesToPrompt(input.userPrompt, input.images) }
        : input;
    let state: WorkflowState = createInitialWorkflowState(enhancedInput);
    const startMs = Date.now();
    deps.metrics?.recordAiTokenUsage({
      modelRole: "streaming",
      tokenType: "input",
      tokens: enhancedInput.userPrompt.length,
    });
    yield {
      data: { message: "Codegen workflow started" },
      event: "workflow-start",
    };
    yield stepEvent("promptEnhance", 1);
    yield stepEvent("router", 3);

    try {
      deps.metrics?.recordAiRequest({ modelRole: "streaming", status: "success" });
      state = yield* runCodegenAttempts({
        codeGenerator: deps.codeGenerator,
        maxAttempts,
        qualityChecker: deps.qualityChecker,
        state,
      });
      deps.metrics?.recordAiResponseTime({
        modelRole: "streaming",
        durationMs: Date.now() - startMs,
      });
      deps.metrics?.recordAiTokenUsage({
        modelRole: "streaming",
        tokenType: "output",
        tokens: state.generatedCode.length,
      });

      if (!state.qualityCheckPassed) {
        deps.metrics?.recordAiError({ modelRole: "quality", errorType: "quality-check-failed" });
        yield operationErrorEvent(state.qualityCheckMessage);
        return;
      }

      state.history.push(
        { role: "user", content: input.userPrompt },
        { role: "ai", content: state.generatedCode },
      );

      const finalized = await finalizeGeneratedProject({
        ...(deps.outputRootDir !== undefined && {
          outputRootDir: deps.outputRootDir,
        }),
        state,
      });
      state = finalized.state;
      for (const event of finalized.events) yield event;
      if (finalized.failed) return;

      yield { data: { outputDir: state.outputDir, history: state.history }, event: "done" };
    } catch {
      deps.metrics?.recordAiRequest({ modelRole: "streaming", status: "error" });
      yield operationErrorEvent("Codegen workflow failed unexpectedly");
    }
  }

  return { execute };
};

export type CodegenWorkflow = ReturnType<typeof createCodegenWorkflow>;
export type {
  CodeGenerator,
  CodegenWorkflowDeps,
  ExecuteWorkflowInput,
  QualityChecker,
} from "./workflow-types.js";
