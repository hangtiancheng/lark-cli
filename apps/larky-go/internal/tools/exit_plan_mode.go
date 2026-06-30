package tools

import "context"

type ExitPlanModeTool struct {
	IsPlanMode func() bool
	PlanExists func() bool
}

func (t *ExitPlanModeTool) Name() string { return "ExitPlanMode" }

func (t *ExitPlanModeTool) Description() string {
	return "Exit plan mode and present the plan for user approval. " +
		"Call this when your plan is complete and written to the plan file."
}

func (t *ExitPlanModeTool) Category() ToolCategory { return CategoryRead }

func (t *ExitPlanModeTool) Schema() map[string]any {
	return map[string]any{
		"name":        "ExitPlanMode",
		"description": t.Description(),
		"input_schema": map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	}
}

func (t *ExitPlanModeTool) Execute(ctx context.Context, args map[string]any) ToolResult {
	if t.IsPlanMode != nil && !t.IsPlanMode() {
		return ToolResult{
			Output:  "You are not in plan mode. This tool is only for exiting plan mode after writing a plan.",
			IsError: true,
		}
	}
	if t.PlanExists != nil && !t.PlanExists() {
		return ToolResult{
			Output:  "No plan file found. Please write your plan to the plan file before calling ExitPlanMode.",
			IsError: true,
		}
	}
	return ToolResult{
		Output: "Plan mode will be exited after this turn. " +
			"The user will be shown the plan approval dialog. " +
			"Do not call any more tools — end your turn now.",
	}
}
