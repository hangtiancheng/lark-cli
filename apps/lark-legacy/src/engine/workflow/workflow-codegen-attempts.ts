import { chunkEvent, stepEvent, type WorkflowEvent } from "./workflow-events.js";
import type { WorkflowState } from "./workflow-state.js";
import type { CodegenStreamMetadata, CodeGenerator, QualityChecker } from "./workflow-types.js";

export type RunCodegenAttemptsInput = Readonly<{
  codeGenerator: CodeGenerator;
  maxAttempts: number;
  qualityChecker: QualityChecker;
  state: WorkflowState;
}>;

export async function* runCodegenAttempts(
  input: RunCodegenAttemptsInput,
): AsyncGenerator<WorkflowEvent, WorkflowState> {
  let state = input.state;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    let generatedCode = "";
    let _finalMetadata: CodegenStreamMetadata | undefined;
    for await (const chunk of input.codeGenerator.streamCode({
      codegenType: state.codegenType,
      prompt: state.enhancedPrompt,
      history: state.history,
    })) {
      if (chunk.metadata !== undefined) _finalMetadata = chunk.metadata;
      if (chunk.content.length === 0) continue;
      generatedCode += chunk.content;
      yield chunkEvent(chunk.content);
    }
    state = { ...state, generatedCode };
    yield stepEvent("codegen", 4 + (attempt - 1) * 2);

    const quality = await input.qualityChecker.check({
      code: generatedCode,
      codegenType: state.codegenType,
    });
    state = {
      ...state,
      qualityCheckMessage: quality.message,
      qualityCheckPassed: quality.passed,
    };
    yield stepEvent("qualityCheck", 5 + (attempt - 1) * 2);
    if (quality.passed) break;
  }
  return state;
}
