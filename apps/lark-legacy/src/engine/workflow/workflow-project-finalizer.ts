import { CodegenType } from "../codegen-type.js";
import { buildViteProject, parseGeneratedCode, saveGeneratedProject } from "../project/index.js";
import { operationErrorEvent, stepEvent, type WorkflowEvent } from "./workflow-events.js";
import type { WorkflowState } from "./workflow-state.js";

export type FinalizeGeneratedProjectInput = Readonly<{
  outputRootDir?: string;
  state: WorkflowState;
}>;

export type FinalizeGeneratedProjectResult = Readonly<{
  events: readonly WorkflowEvent[];
  failed: boolean;
  state: WorkflowState;
}>;

export const finalizeGeneratedProject = async (
  input: FinalizeGeneratedProjectInput,
): Promise<FinalizeGeneratedProjectResult> => {
  const events: WorkflowEvent[] = [];
  const parsed = parseGeneratedCode(input.state.generatedCode, input.state.codegenType);
  const saved = await saveGeneratedProject({
    codegenType: input.state.codegenType,
    parsedProject: parsed,
    projectName: input.state.projectName,
    ...(input.outputRootDir !== undefined && { rootDir: input.outputRootDir }),
  });
  let state: WorkflowState = { ...input.state, outputDir: saved.outputDir };
  events.push(stepEvent("saveProject", 10));

  if (state.codegenType !== CodegenType.VITE_PROJECT) {
    return { events, failed: false, state };
  }

  const build = await buildViteProject(saved.outputDir);
  state = { ...state, buildLogs: build.logs, buildSuccess: build.success };
  events.push(stepEvent("projectBuild", 11));
  if (build.success) return { events, failed: false, state };

  events.push(operationErrorEvent("Project build failed"));
  return { events, failed: true, state };
};
