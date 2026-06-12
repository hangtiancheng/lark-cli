import type { CodegenType } from "../codegen-type.js";
import type { ImageCategory } from "./image-assets.js";
import type { MetricsService } from "../observability/index.js";

export type CodegenStreamMetadata = Readonly<{
  response_metadata?: Readonly<{
    done_reason?: string;
    eval_count?: number;
  }>;
  usage_metadata?: Readonly<{
    output_tokens?: number;
  }>;
}>;

export type CodegenStreamChunk = Readonly<{
  content: string;
  metadata?: CodegenStreamMetadata;
}>;

export type ChatMessage = Readonly<{
  role: "user" | "ai";
  content: string;
}>;

export type CodeGenerator = Readonly<{
  streamCode: (input: {
    codegenType: CodegenType;
    prompt: string;
    history?: readonly ChatMessage[];
  }) => AsyncIterable<CodegenStreamChunk>;
}>;

export type QualityChecker = Readonly<{
  check: (input: { code: string; codegenType: CodegenType }) => Promise<{
    message: string;
    passed: boolean;
  }>;
}>;

export type CodegenWorkflowDeps = Readonly<{
  codeGenerator: CodeGenerator;
  maxAttempts?: number;
  metrics?: MetricsService;
  outputRootDir?: string;
  qualityChecker: QualityChecker;
}>;

export type ImageResource = Readonly<{
  category: ImageCategory;
  description: string;
  url: string;
}>;

export type ExecuteWorkflowInput = Readonly<{
  codegenType: CodegenType;
  projectName: string;
  userPrompt: string;
  history?: readonly ChatMessage[];
  images?: readonly ImageResource[];
}>;
