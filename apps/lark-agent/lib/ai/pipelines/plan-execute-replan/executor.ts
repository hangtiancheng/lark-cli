// Step executor
// Uses AI SDK generateText with tools + stopWhen for multi-step tool execution
// within a single plan step.
import { generateText, isStepCount, type Tool } from "ai";
import { quickModel } from "../../models";

export interface StepResult {
  text: string;
}

export async function executeStep(step: string, tools: Record<string, Tool>): Promise<StepResult> {
  const result = await generateText({
    model: quickModel,
    prompt: step,
    tools,
    stopWhen: isStepCount(10),
  });
  return { text: result.text };
}
