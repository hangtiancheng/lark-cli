package subagent

import (
	"context"
	"fmt"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// SpawnAgentTool creates isolated sub-agents for delegated tasks.
type SpawnAgentTool struct {
	registry  *Registry
	nestLevel int
}

const maxNestLevel = 2

// NewSpawnAgentTool creates a new SpawnAgentTool with the given registry and nesting level.
func NewSpawnAgentTool(registry *Registry, nestLevel int) *SpawnAgentTool {
	return &SpawnAgentTool{
		registry:  registry,
		nestLevel: nestLevel,
	}
}

func (t *SpawnAgentTool) Name() string        { return "spawn_agent" }
func (t *SpawnAgentTool) Description() string { return "Spawn a sub-agent to perform an isolated task" }
func (t *SpawnAgentTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"description": map[string]any{
				"type":        "string",
				"description": "What the sub-agent should do",
			},
			"goal": map[string]any{
				"type":        "string",
				"description": "The goal for the sub-agent",
			},
		},
		"required": []string{"description", "goal"},
	}
}

func (t *SpawnAgentTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	if t.nestLevel >= maxNestLevel {
		return &tools.ToolResult{
			Content:   fmt.Sprintf("nesting limit reached (max %d levels)", maxNestLevel),
			IsError:   true,
			ErrorType: tools.ErrorTypeRuntime,
		}, nil
	}

	_, ok := params["description"].(string)
	if !ok {
		return &tools.ToolResult{Content: "description is required", IsError: true, ErrorType: tools.ErrorTypeSchema}, nil
	}
	_, ok = params["goal"].(string)
	if !ok {
		return &tools.ToolResult{Content: "goal is required", IsError: true, ErrorType: tools.ErrorTypeSchema}, nil
	}

	// Generate a run ID and register the task
	runID := GenerateRunID()
	t.registry.Register(runID)

	// Note: actual agent execution is driven by the runner layer.
	// This tool only registers the task and returns the run_id.
	return &tools.ToolResult{
		Content: fmt.Sprintf("sub-agent spawned with run_id: %s", runID),
	}, nil
}

// AgentResultTool queries the result of a background sub-agent.
type AgentResultTool struct {
	registry *Registry
}

// NewAgentResultTool creates a new AgentResultTool.
func NewAgentResultTool(registry *Registry) *AgentResultTool {
	return &AgentResultTool{registry: registry}
}

func (t *AgentResultTool) Name() string        { return "agent_result" }
func (t *AgentResultTool) Description() string { return "Get the result of a background sub-agent" }
func (t *AgentResultTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"run_id": map[string]any{
				"type":        "string",
				"description": "The run_id of the sub-agent",
			},
		},
		"required": []string{"run_id"},
	}
}

func (t *AgentResultTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	runID, ok := params["run_id"].(string)
	if !ok {
		return &tools.ToolResult{Content: "run_id is required", IsError: true, ErrorType: tools.ErrorTypeSchema}, nil
	}

	entry, ok := t.registry.Get(runID)
	if !ok {
		return &tools.ToolResult{
			Content:   fmt.Sprintf("no sub-agent found with run_id: %s", runID),
			IsError:   true,
			ErrorType: tools.ErrorTypeRuntime,
		}, nil
	}

	switch entry.Status {
	case "running":
		return &tools.ToolResult{Content: "sub-agent is still running"}, nil
	case "success":
		return &tools.ToolResult{Content: entry.Result}, nil
	case "failed":
		return &tools.ToolResult{
			Content:   entry.Result,
			IsError:   true,
			ErrorType: tools.ErrorTypeRuntime,
		}, nil
	default:
		return &tools.ToolResult{Content: fmt.Sprintf("unknown status: %s", entry.Status)}, nil
	}
}

// ensure tool interface compliance
var _ tools.Tool = (*SpawnAgentTool)(nil)
var _ tools.Tool = (*AgentResultTool)(nil)
