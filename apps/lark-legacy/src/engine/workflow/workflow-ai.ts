import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  CODE_QUALITY_CHECK_SYSTEM_PROMPT,
  getSystemPrompt,
} from "../ai/prompts/prompt-registry.js";
import type { AiModelRegistry } from "../ai/models/model-registry.js";
import { CodegenType } from "../codegen-type.js";
import { describeViteOutputCompletenessIssue } from "./vite-output-completeness.js";
import type {
  ChatMessage,
  CodeGenerator,
  CodegenStreamMetadata,
  QualityChecker,
} from "./workflow-types.js";

const streamChunkSchema = z.object({
  content: z.string(),
  response_metadata: z
    .object({
      done_reason: z.string().optional(),
      eval_count: z.number().optional(),
    })
    .optional(),
  usage_metadata: z
    .object({
      output_tokens: z.number().optional(),
    })
    .optional(),
});
const messageChunkSchema = z.object({ content: z.string() });

const qualityResultSchema = z.object({
  issues: z.array(z.string()).optional(),
  passed: z.boolean().optional(),
  score: z.number().int().min(0).max(100).optional(),
});

const extractJsonObject = (content: string): string | undefined =>
  /\{[\s\S]*\}/u.exec(content)?.[0];

const extractStreamMetadata = (
  chunk: z.infer<typeof streamChunkSchema>,
): CodegenStreamMetadata | undefined => {
  const responseMetadata = chunk.response_metadata;
  const usageMetadata = chunk.usage_metadata;
  const metadata: {
    response_metadata?: { done_reason?: string; eval_count?: number };
    usage_metadata?: { output_tokens?: number };
  } = {};
  if (responseMetadata?.done_reason !== undefined || responseMetadata?.eval_count !== undefined) {
    metadata.response_metadata = {
      ...(responseMetadata.done_reason !== undefined && {
        done_reason: responseMetadata.done_reason,
      }),
      ...(responseMetadata.eval_count !== undefined && {
        eval_count: responseMetadata.eval_count,
      }),
    };
  }
  if (usageMetadata?.output_tokens !== undefined) {
    metadata.usage_metadata = { output_tokens: usageMetadata.output_tokens };
  }
  return metadata.response_metadata !== undefined || metadata.usage_metadata !== undefined
    ? metadata
    : undefined;
};

const buildMessages = (
  codegenType: CodegenType,
  prompt: string,
  history?: readonly ChatMessage[],
): BaseMessage[] => {
  const messages: BaseMessage[] = [new SystemMessage(getSystemPrompt(codegenType))];
  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push(
        msg.role === "user" ? new HumanMessage(msg.content) : new AIMessage(msg.content),
      );
    }
  }
  messages.push(new HumanMessage(prompt));
  return messages;
};

export const createLangChainCodeGenerator = (registry: AiModelRegistry): CodeGenerator => ({
  streamCode: async function* ({ codegenType, prompt, history }) {
    const model = registry.createModel("streaming");
    const stream = await model.stream(buildMessages(codegenType, prompt, history));
    for await (const chunk of stream) {
      const parsed = streamChunkSchema.safeParse(chunk);
      if (parsed.success) {
        const metadata = extractStreamMetadata(parsed.data);
        if (parsed.data.content.length > 0 || metadata !== undefined) {
          yield {
            content: parsed.data.content,
            ...(metadata !== undefined && { metadata }),
          };
        }
      }
    }
  },
});

export const createLangChainQualityChecker = (registry: AiModelRegistry): QualityChecker => ({
  check: async ({ code, codegenType }) => {
    if (code.trim().length === 0) {
      return { message: "No code generated", passed: false };
    }
    if (codegenType === CodegenType.VITE_PROJECT) {
      const issue = describeViteOutputCompletenessIssue(code);
      if (issue !== undefined) return { message: issue, passed: false };
    }
    const model = registry.createModel("quality");
    const responseFormat =
      'Respond with JSON only: {"passed": boolean, "score": integer, "issues": string[]}.';
    const scoreRule =
      "The score MUST be a percentage integer from 0 to 100, never a 0-10 rating or decimal.";
    const response = await model.invoke([
      new SystemMessage(`${CODE_QUALITY_CHECK_SYSTEM_PROMPT}\n${responseFormat} ${scoreRule}`),
      new HumanMessage(`Check this code:\n\n${code}`),
    ]);
    const parsed = messageChunkSchema.safeParse(response);
    const content = parsed.success ? parsed.data.content : "";
    const json = extractJsonObject(content);
    if (json === undefined) return { message: content, passed: true };
    return { message: content, passed: isQualityPassed(json) };
  },
});

export const isQualityPassed = (json: string): boolean => {
  const raw: unknown = JSON.parse(json);
  const result = qualityResultSchema.parse(raw);
  if (result.passed !== undefined) return result.passed;
  return (result.score ?? 100) >= 60;
};

export const createNoopQualityChecker = (): QualityChecker => ({
  check: async ({ code }) => ({
    message: code.trim().length === 0 ? "No code generated" : "Quality check passed",
    passed: code.trim().length > 0,
  }),
});
