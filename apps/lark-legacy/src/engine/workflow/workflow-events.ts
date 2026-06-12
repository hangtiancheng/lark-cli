import { ErrorCode } from "../errors.js";
import type { ChatMessage } from "./workflow-types.js";

export type WorkflowStep =
  | "promptEnhance"
  | "router"
  | "codegen"
  | "qualityCheck"
  | "projectBuild"
  | "saveProject";

export type WorkflowEvent =
  | { event: "workflow-start"; data: { message: string } }
  | { event: "step-complete"; data: { step: WorkflowStep; stepNumber: number } }
  | { event: "chunk"; data: { d: string } }
  | { event: "business-error"; data: { code: number; message: string } }
  | { event: "done"; data: { outputDir?: string; history?: ChatMessage[] } };

export const stepEvent = (step: WorkflowStep, stepNumber: number): WorkflowEvent => ({
  data: { step, stepNumber },
  event: "step-complete",
});

export const chunkEvent = (chunk: string): WorkflowEvent => ({
  data: { d: chunk },
  event: "chunk",
});

export const operationErrorEvent = (message: string): WorkflowEvent => ({
  data: { code: ErrorCode.OperationError, message },
  event: "business-error",
});
