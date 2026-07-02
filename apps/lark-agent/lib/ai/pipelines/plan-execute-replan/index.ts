// Corresponds to plan_execute_replan (plan_execute_replan.go, planner.go,
// executor.go, replan.go).
// Planner (think) → Executor (quick + tools) → Replanner (think) loop,
// MaxIterations=20.
// event-stream pattern.
import { generateObject, type Tool } from "ai";
import { z } from "zod/v4";
import { thinkModel } from "../../models";
import { builtinTools } from "../../tools";
import { getLogMcpTools } from "../../tools/query-log";
import { executeStep } from "./executor";
import type { PlanExecuteEvent } from "./events";
import { logStart, logEnd } from "@/lib/ai/callbacks";

const MAX_ITERATIONS = 20;

// AI Ops query migrated from chat_v1_ai_ops.go.
const AI_OPS_QUERY = `1. You are an intelligent service alert analysis assistant. First, call the tool query_prometheus_alerts to retrieve all active alerts.
2. For each alert, call the tool query_internal_docs by alert name to retrieve the corresponding handling procedure.
3. Strictly follow the internal documentation for queries and analysis; do not use any information outside the documentation.
4. For any time-related parameters, first call the tool get_current_time to obtain the current time, then pass parameters according to the tool's time requirements.
5. For log queries, first use the log tool to retrieve relevant log information; parameters must include the region and log topic.
6. Summarize and analyze the information retrieved for each alert, then generate an alert operations analysis report in the following format:
Alert Analysis Report
---
# Alert Handling Details
## Active Alert List
## Alert Root Cause Analysis N (the Nth alert)
## Handling Procedure Execution N (the Nth alert)
## Conclusion
`;

const planSchema = z.object({
  steps: z.array(z.string()).describe("Ordered steps to accomplish the task"),
});

const replanSchema = z.object({
  done: z.boolean().describe("Whether the overall task is complete"),
  remaining: z.array(z.string()).describe("Remaining steps if not done; empty when done"),
  summary: z.string().describe("Final report / summary when done"),
});

async function buildTools(): Promise<Record<string, Tool>> {
  const mcp = await getLogMcpTools();
  return { ...mcp, ...builtinTools };
}

export async function* runPlanExecuteReplan(
  query: string = AI_OPS_QUERY,
): AsyncGenerator<PlanExecuteEvent> {
  const tools = await buildTools();
  logStart("PlanExecuteReplan");

  try {
    // Planner
    const planResult = await generateObject({
      model: thinkModel,
      schema: planSchema,
      prompt: `Break down the following task into concrete steps.\n\nTask:\n${query}`,
    });
    let plan = planResult.object.steps;
    yield { type: "plan_created", steps: plan };

    const detail: string[] = [];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (plan.length === 0) break;

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        yield { type: "step_start", index: i, step };
        const res = await executeStep(step, tools);
        detail.push(res.text);
        yield { type: "step_done", index: i, output: res.text };
      }

      // Replanner
      const replanResult = await generateObject({
        model: thinkModel,
        schema: replanSchema,
        prompt: `Task:\n${query}\n\nCompleted steps:\n${plan
          .map((s, idx) => `${idx + 1}. ${s}`)
          .join("\n")}\n\nResults so far:\n${detail.join(
          "\n",
        )}\n\nIs the task complete? If not, list remaining steps. If done, provide the final report.`,
      });
      const obj = replanResult.object;
      yield { type: "replan", done: obj.done, remaining: obj.remaining };

      if (obj.done) {
        yield { type: "done", result: obj.summary, detail };
        return;
      }
      plan = obj.remaining;
    }

    yield { type: "done", result: "Max iterations reached", detail };
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : String(e) };
  } finally {
    logEnd("PlanExecuteReplan");
  }
}
