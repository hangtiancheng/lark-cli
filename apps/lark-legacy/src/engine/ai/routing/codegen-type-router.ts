import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { CodegenType } from "../../codegen-type.js";
import { CliError, ErrorCode } from "../../errors.js";
import type { AiModelRegistry } from "../models/model-registry.js";
import { ROUTE_SYSTEM_PROMPT } from "../prompts/prompt-registry.js";

const routeClassificationSchema = z
  .object({
    codegenType: z.enum([
      CodegenType.VANILLA_HTML,
      CodegenType.MULTI_FILES,
      CodegenType.VITE_PROJECT,
    ]),
  })
  .strict();

const modelResponseSchema = z.object({
  content: z.string(),
});

const fencedJsonPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/u;

export type RouteMessages = readonly [SystemMessage, HumanMessage];

export type RouteModelInvoker = Readonly<{
  invoke: (messages: RouteMessages) => Promise<unknown>;
}>;

export type CodegenRouter = Readonly<{
  routeCodegenType: (initPrompt: string) => Promise<CodegenType>;
}>;

const parseRouteClassification = (content: string): CodegenType => {
  const normalizedContent = normalizeRouteContent(content);
  const parsedJson: unknown = JSON.parse(normalizedContent);
  return routeClassificationSchema.parse(parsedJson).codegenType;
};

const normalizeRouteContent = (content: string): string => {
  const trimmed = content.trim();
  const match = fencedJsonPattern.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
};

export const createCodegenTypeRouter = (model: RouteModelInvoker): CodegenRouter => ({
  routeCodegenType: async (initPrompt) => {
    const response = await model.invoke([
      new SystemMessage(ROUTE_SYSTEM_PROMPT),
      new HumanMessage(initPrompt),
    ]);
    const content = modelResponseSchema.parse(response).content.trim();
    try {
      return parseRouteClassification(content);
    } catch {
      throw new CliError(
        ErrorCode.OperationError,
        "Model returned an invalid code generation route",
      );
    }
  },
});

export const createLangChainCodegenRouter = (registry: AiModelRegistry): CodegenRouter => {
  const model = registry.createModel("route");
  return createCodegenTypeRouter({
    invoke: async (messages) => model.invoke([...messages]),
  });
};
