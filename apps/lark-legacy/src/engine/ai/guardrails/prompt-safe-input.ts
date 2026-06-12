import { CliError, ErrorCode } from "../../errors.js";

const MAX_INPUT_LENGTH = 1000;

const SENSITIVE_WORDS: ReadonlyArray<string> = [
  "ignore above",
  "ignore previous",
  "disregard",
  "forget previous",
  "jailbreak",
  "bypass",
  "override instructions",
];

const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\{\{.*?\}\}/u,
  /ignore all previous commands/iu,
  /act as if you are/iu,
  /pretend you are/iu,
  /you are now/iu,
  /new instructions/iu,
  /system:\s/iu,
  /\[INST\]/iu,
  /\[\/INST\]/iu,
];

export type SafePromptResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "too-long" | "sensitive" | "injection" };

export const inspectPrompt = (input: string): SafePromptResult => {
  if (input.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  const lower = input.toLowerCase();
  if (SENSITIVE_WORDS.some((word) => lower.includes(word))) {
    return { ok: false, reason: "sensitive" };
  }
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(input))) {
    return { ok: false, reason: "injection" };
  }
  return { ok: true };
};

const reasonMessage: Readonly<Record<Exclude<SafePromptResult, { ok: true }>["reason"], string>> = {
  empty: "Input cannot be empty",
  injection: "Injection pattern detected",
  sensitive: "Sensitive word detected",
  "too-long": `The input cannot exceed ${MAX_INPUT_LENGTH} characters.`,
};

export const assertSafePrompt = (input: string): void => {
  const result = inspectPrompt(input);
  if (!result.ok) {
    throw new CliError(ErrorCode.ParamsError, reasonMessage[result.reason]);
  }
};

export const PROMPT_GUARDRAIL_LIMIT = MAX_INPUT_LENGTH;
