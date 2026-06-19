import type {
  Tool,
  ToolCategory,
  ToolContext,
  ToolResult,
  ToolSchema,
} from "./types.js";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// Maps each question text to the user's chosen answer (labels joined for multi-select, or free text for "Other")

export type Asker = (
  questions: Question[],
) => Promise<
  Record<string /** question text */, string /** user chosen answer */>
>;

// Structured multiple-choice question tool
// The actual prompting is delegated to an injected asker (the TUI dialog),
// the same pattern as onPermissionRequest
export class AskUserQuestionTool implements Tool {
  name = AskUserQuestionTool.name.replace("Tool", "");

  description = `
  Ask the user 1 to 4 single-choice or multiple-choice questions and wait for their answers. Each question needs 1 to 4 options; an "Other" option for custom input is added automatically.
  Set "multiSelect: true" when choices are not mutually exclusive (single-choice), set "multiSelect: false" otherwise (multiple-choice).
  `;

  system = true;

  category: ToolCategory = "read";
  constructor(private ask: Asker) {}

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1, // Minimum questions count
            maxItems: 4, // Maximum questions count
            items: {
              type: "object",
              properties: {
                question: {
                  type: "string",
                  description: "The question to ask",
                },
                header: {
                  type: "string",
                  description: "Short label/category (<=12 chars)",
                },
                options: {
                  type: "array",
                  minItems: 2, // Minimum options count
                  maxItems: 4, // Maximum options count
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label"],
                  },
                },
                multiSelect: {
                  type: "boolean",
                  description:
                    "Set to true for multiple-choice, false for single-choice",
                },
                required: ["question", "header", "options", "multiSelect"],
              },
            },
          },
          required: ["questions"],
        },
      },
    };
  }

  async execute(
    ctx: ToolContext,
    args: { questions: Question[] | undefined },
  ): Promise<ToolResult> {
    const questions = args.questions;
    if (
      !Array.isArray(questions) ||
      questions.length < 1 ||
      questions.length > 4
    ) {
      return { output: "Error: must have 1-4 questions", isError: true };
    }

    for (const q of questions) {
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 4
      ) {
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
