import type OpenAI from "openai";
import type { Tool, ToolSchema } from "./types.js";
import type Anthropic from "@anthropic-ai/sdk";

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
  Record<string /** question text */, string /** user;s chosen answer */>
>;

// Structured multiple-choice question tool 
// The actual prompting is delegated to an injected asker (the TUI dialog),
// the same pattern as onPermissionRequest
export class AskUserQuestionTool implements Tool {
  name = AskUserQuestionTool.name;

  description = `
  Ask the user 1 to 4 single-choice or multiple-choice questions and wait for their answers. Each question needs 1 to 4 options; an "Other" option for custom input is added automatically.
  Set "multiSelect: true" when choices are not mutually exclusive (single-choice), set "multiSelect: false" otherwise (multiple-choice).
  `;

  system = true;

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
            minItems: 1,
            maxItems: 4,
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
                  minItems: 1,
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["label"],
                  }
                },
                multiSelect: {
                  type: "boolean",
                  description: "Set to true for multiple-choice, false for single-choice",
                },
                required: ["question", "header", "options", "multiSelect"],
              }
            }
          },
          required: ["questions"],
        }
      },
    };
  }
}
