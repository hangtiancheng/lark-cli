import { safeParseAsync, z } from "zod";
import type { Tool, ToolCategory, ToolContext, ToolResult, ToolSchema } from "./types.js";

const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

const QuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(QuestionOptionSchema),
  multiSelect: z.boolean(),
});

export type Question = z.infer<typeof QuestionSchema>;

// Maps each question text to the user's chosen answer (labels joined for multi-select, or free text for "Other")

export type Asker = (
  questions: Question[],
) => Promise<Record<string /** question text */, string /** user chosen answer */>>;

// Structured multiple-choices question tool
// The actual prompting is delegated to an injected asker (the TUI dialog),
// the same pattern as onPermissionRequest
export class AskUserQuestionTool implements Tool {
  // Use a hardcoded string instead of AskUserQuestionTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "AskUserQuestion";

  description = `
  Ask the user 1 to 4 single-choice or multiple-choices questions and wait for their answers. Each question needs 1 to 4 options; an "Other" option for custom input is added automatically.
  Set "multiSelect: true" when choices are not mutually exclusive (single-choice), set "multiSelect: false" otherwise (multiple-choices).
  `;

  system = true;

  category: ToolCategory = "read";
  constructor(private ask: Asker) {}

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        questions: {
          type: "array" as const,
          description: "question",
          minItems: 1, // Minimum questions count
          maxItems: 4, // Maximum questions count
          items: {
            type: "object" as const,
            properties: {
              question: {
                type: "string" as const,
                description: "The question to ask",
              },
              header: {
                type: "string" as const,
                description: "Short label/category (<=12 chars)",
              },
              options: {
                type: "array" as const,
                description: "options",
                minItems: 2, // Minimum options count
                maxItems: 4, // Maximum options count
                items: {
                  type: "object" as const,
                  properties: {
                    label: {
                      type: "string" as const,
                      description: "label",
                    },
                    description: {
                      type: "string" as const,
                      description: "description",
                    },
                  },
                  required: ["label"],
                },
              },
              multiSelect: {
                type: "boolean" as const,
                description: "Set to true for multiple-choice, false for single-choice",
              },
            },
            required: ["question", "header", "options", "multiSelect"],
          },
        },
      },
      required: ["questions"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const {
      success,
      data: argsData,
      error,
    } = await safeParseAsync(z.object({ questions: z.array(QuestionSchema) }), args);
    if (!success) {
      return {
        output: error.message,
        isError: true,
      };
    }

    // TODO: Migrate manual parse to zod.
    const questions = argsData.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) {
      return { output: "Error: must have 1-4 questions", isError: true };
    }

    for (const q of questions) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
        return {
          output: `Error: question '${q.question}' must have 2-4 options`,
          isError: true,
        };
      }
    }

    // Wait for user ask
    const answer = await this.ask(questions);
    const parts = Object.entries(answer).map(([q, a]) => `"${q}" = "${a}"`);

    return {
      output: `User has answered your questions: ${parts.join(", ")}. You can now continue with the user's answers`,
      isError: false,
    };
  }
}
