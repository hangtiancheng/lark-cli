import type { CodegenType } from "../codegen-type.js";
import type { ChatMessage } from "./workflow-types.js";

export type WorkflowState = {
  codegenType: CodegenType;
  enhancedPrompt: string;
  generatedCode: string;
  history: ChatMessage[];
  outputDir?: string;
  projectName: string;
  qualityCheckMessage: string;
  qualityCheckPassed: boolean;
  userPrompt: string;
  buildLogs: string;
  buildSuccess: boolean;
};

export const createInitialWorkflowState = (input: {
  codegenType: CodegenType;
  projectName: string;
  userPrompt: string;
  history?: readonly ChatMessage[];
}): WorkflowState => ({
  codegenType: input.codegenType,
  enhancedPrompt: input.userPrompt,
  generatedCode: "",
  history: input.history ? [...input.history] : [],
  projectName: input.projectName,
  qualityCheckMessage: "",
  qualityCheckPassed: false,
  userPrompt: input.userPrompt,
  buildLogs: "",
  buildSuccess: false,
});
