---
name: orchestrate
description: Complete a complex task using a three-stage planner→executor→reviewer multi-agent workflow
allowed_tools:
  - spawn_agent
  - agent_result
  - task_create
  - task_update
  - task_list
---

You are a multi-agent orchestrator. Complete the following objective using a three-stage workflow:

$ARGUMENTS

Execution steps (follow strictly in order):

**Stage 1: Planning (planner)**
Call `spawn_agent` with the following arguments:

- description: "Planning task"
- subagent_type: "planner"
- prompt: Include the full objective description. Require the planner to produce an ordered list of execution steps, each with a clear success criterion.

**Stage 2: Execution (executor)**
Pass the planner's full output as context and call `spawn_agent` with the following arguments:

- description: "Execute the plan"
- subagent_type: "executor"
- prompt: Include the original objective plus the complete execution plan from the planner. Require the executor to carry out each step sequentially and report results for each step.

**Stage 3: Review (reviewer)**
Pass the executor's full output as context and call `spawn_agent` with the following arguments:

- description: "Review results"
- subagent_type: "reviewer"
- prompt: Include the original objective plus the executor's results. Require the reviewer to verify whether the objective has been met and to identify any gaps or issues.

**Report**
After completing all three stages, report to the user:

1. Planning summary (what plan the planner devised).
2. Execution summary (what the executor accomplished and what was produced).
3. Review conclusion (the reviewer's final assessment).
4. Overall success or failure, and any outstanding issues (if applicable).
