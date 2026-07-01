// Corresponds to plan_execute_replan (plan_execute_replan.go, planner.go,
// executor.go, replan.go).
// Planner (think) → Executor (quick + tools) → Replanner (think) loop,
// MaxIterations=20. Inspired by mewcode-typescript/src/agent's AsyncGenerator
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

// AI Ops query migrated from chat_v1_ai_ops.go (business content preserved).
const AI_OPS_QUERY = `1. 你是一个智能的服务告警分析助手,首先调用工具query_prometheus_alerts获取所有活跃的告警。
2. 分别根据告警的名称调用工具query_internal_docs,获取告警名对应的处理方案。
3. 完全遵循内部文档的内容进行查询和分析,不允许使用文档外的任何信息。
4. 涉及到时间的参数都需要先通过工具get_current_time获取当前时间,再结合工具的时间要求进行传参。
5. 涉及到日志的查询,需要先通过日志工具获取相关日志信息,参数必须携带地域和日志主题。
6. 分别将告警对应查询到的信息进行总结分析,最后生成告警运维分析报告,格式如下:
告警分析报告
---
# 告警处理详情
## 活跃告警清单
## 告警根因分析N(第N个告警)
## 处理方案执行N(第N个告警)
## 结论
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
