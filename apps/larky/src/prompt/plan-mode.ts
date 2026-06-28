// Plan Mode full reminder: displayed on the first iteration and every reminderInterval iterations
const planModeFullReminder = `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:

%PLAN_FILE_INFO%
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding

Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should use the Agent tool with subagent_type="explore".

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

2. **Call the Agent tool with subagent_type="explore" to explore the codebase.** You can launch up to 3 explore agents IN PARALLEL by making multiple Agent tool calls in a single response.

### Phase 2: Design

Goal: Design an implementation approach.

Call the Agent tool with subagent_type="plan" to design the implementation based on the user's intent and your exploration results from Phase 1.

### Phase 3: Review

Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.

1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use AskUserQuestion to clarify any remaining questions with the user.

### Phase 4: Final Plan

Goal: Write your final plan to the plan file (the only file you can edit).

- Begin with a **Context** section
- Include only your recommended approach
- Include the paths of critical files to be modified
- Include a verification section

### Phase 5: Call ExitPlanMode

At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ExitPlanMode.
`;

// Plan Mode sparse reminder: only key rules are displayed during intermediate iterations
const planModeSparseReminder = `Plan mode still active (see full instructions earlier in conversation). Read-only except plan file (%PLAN_PATH%). Follow 5-phase workflow. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval). Never ask about plan approval via text or AskUserQuestion.`;

// Prompt for exiting Plan Mode
const planModeExitTemplate = `## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.%EXTRA%`;

// Prompt for re-entering Plan Mode: reminds the model that a plan file already exists and can be continued
const planModeReentryTemplate = `You have re-entered plan mode. Your previous plan file is at %PLAN_PATH%. Review it and continue from where you left off. You can update, refine, or restart the plan as needed. Follow the same 5-phase workflow as before.`;

// How many iterations before repeating the full reminder
const reminderInterval = 5;

/**
 * Builds the Plan Mode reminder, switching between full and sparse reminders based on the iteration count.
 * Always shows the full reminder on iteration=1; repeats the full reminder every reminderInterval iterations,
 * and returns the sparse reminder for other iterations to save tokens.
 */
export function buildPlanModeReminder(
  planPath: string,
  planExist: boolean,
  iteration: number,
): string {
  // Construct the plan file info section
  let planFileInfo = `Plan file: ${planPath}`;
  if (planExist) {
    planFileInfo += `\nA plan file already exists at ${planPath}. You can read it and make incremental edits using the EditFile tool.`;
  } else {
    planFileInfo += `\nNo plan file exists yet. You should create your plan at ${planPath} using the WriteFile tool.`;
  }

  // Always show the full reminder on the first iteration
  if (iteration === 1) {
    return planModeFullReminder.replace("%PLAN_FILE_INFO%", planFileInfo);
  }

  // Repeat the full reminder every reminderInterval iterations
  const attachmentIndex = Math.floor((iteration - 1) / reminderInterval);
  if (attachmentIndex % reminderInterval === 0) {
    return planModeFullReminder.replace("%PLAN_FILE_INFO%", planFileInfo);
  }

  // Use the sparse reminder for intermediate iterations
  return planModeSparseReminder.replace("%PLAN_PATH%", planPath);
}

/**
 * Builds the reminder displayed after exiting Plan Mode.
 * If a plan file exists, prompts the model to reference the file path.
 */
export function buildPlanModeExitReminder(planPath: string, planExists: boolean): string {
  let extra = "";
  if (planExists) {
    extra = ` The plan file is located at ${planPath} if you need to reference it.`;
  }
  return planModeExitTemplate.replace("%EXTRA%", extra);
}

/**
 * Builds the reminder displayed when re-entering Plan Mode.
 * Only returns non-empty content if a plan file already exists, reminding the model to continue editing the existing plan.
 */
export function buildPlanModeReentryReminder(planPath: string, planFileExists: boolean): string {
  if (!planFileExists) {
    return "";
  }
  return planModeReentryTemplate.replace("%PLAN_PATH%", planPath);
}
