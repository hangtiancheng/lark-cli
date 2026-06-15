package subagent_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/subagent"
)

// -- Registry --

func TestRegistryRegisterAndGet(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")

	entry, ok := reg.Get("run-1")
	if !ok {
		t.Fatal("expected to find run-1")
	}
	if entry.Status != "running" {
		t.Errorf("expected status 'running', got %q", entry.Status)
	}
}

func TestRegistryGetNotFound(t *testing.T) {
	reg := subagent.NewRegistry()
	_, ok := reg.Get("nonexistent")
	if ok {
		t.Error("expected not found for nonexistent run_id")
	}
}

func TestRegistryComplete(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")
	reg.Complete("run-1", "task done")

	entry, ok := reg.Get("run-1")
	if !ok {
		t.Fatal("expected to find run-1")
	}
	if entry.Status != "success" {
		t.Errorf("expected status 'success', got %q", entry.Status)
	}
	if entry.Result != "task done" {
		t.Errorf("expected result 'task done', got %q", entry.Result)
	}
}

func TestRegistryFail(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")
	reg.Fail("run-1", "something broke")

	entry, ok := reg.Get("run-1")
	if !ok {
		t.Fatal("expected to find run-1")
	}
	if entry.Status != "failed" {
		t.Errorf("expected status 'failed', got %q", entry.Status)
	}
	if entry.Result != "something broke" {
		t.Errorf("expected result 'something broke', got %q", entry.Result)
	}
}

func TestRegistryCompleteNonexistent(t *testing.T) {
	reg := subagent.NewRegistry()
	// Should not panic
	reg.Complete("nonexistent", "result")
	reg.Fail("nonexistent", "reason")
}

// -- SpawnAgentTool --

func TestSpawnAgentToolSuccess(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewSpawnAgentTool(reg, 0)

	result, err := tool.Invoke(context.Background(), map[string]any{
		"description": "analyze code",
		"goal":        "review the changes",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if !strings.Contains(result.Content, "spawned") {
		t.Errorf("expected 'spawned' in content, got %q", result.Content)
	}
}

func TestSpawnAgentToolNestLimit(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewSpawnAgentTool(reg, 2) // at max nest level

	result, err := tool.Invoke(context.Background(), map[string]any{
		"description": "deep task",
		"goal":        "deep goal",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error at max nest level")
	}
	if !strings.Contains(result.Content, "nesting limit") {
		t.Errorf("expected nesting limit message, got %q", result.Content)
	}
}

func TestSpawnAgentToolMissingDescription(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewSpawnAgentTool(reg, 0)

	result, _ := tool.Invoke(context.Background(), map[string]any{
		"goal": "some goal",
	})
	if !result.IsError {
		t.Error("expected error for missing description")
	}
}

func TestSpawnAgentToolMissingGoal(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewSpawnAgentTool(reg, 0)

	result, _ := tool.Invoke(context.Background(), map[string]any{
		"description": "some desc",
	})
	if !result.IsError {
		t.Error("expected error for missing goal")
	}
}

// -- AgentResultTool --

func TestAgentResultToolRunning(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")

	tool := subagent.NewAgentResultTool(reg)
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"run_id": "run-1",
	})
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if !strings.Contains(result.Content, "still running") {
		t.Errorf("expected 'still running', got %q", result.Content)
	}
}

func TestAgentResultToolSuccess(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")
	reg.Complete("run-1", "task completed successfully")

	tool := subagent.NewAgentResultTool(reg)
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"run_id": "run-1",
	})
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if result.Content != "task completed successfully" {
		t.Errorf("expected success result, got %q", result.Content)
	}
}

func TestAgentResultToolFailed(t *testing.T) {
	reg := subagent.NewRegistry()
	reg.Register("run-1")
	reg.Fail("run-1", "execution failed")

	tool := subagent.NewAgentResultTool(reg)
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"run_id": "run-1",
	})
	if !result.IsError {
		t.Error("expected error for failed agent")
	}
	if result.Content != "execution failed" {
		t.Errorf("expected failure reason, got %q", result.Content)
	}
}

func TestAgentResultToolNotFound(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewAgentResultTool(reg)

	result, _ := tool.Invoke(context.Background(), map[string]any{
		"run_id": "nonexistent",
	})
	if !result.IsError {
		t.Error("expected error for nonexistent run_id")
	}
}

func TestAgentResultToolMissingRunID(t *testing.T) {
	reg := subagent.NewRegistry()
	tool := subagent.NewAgentResultTool(reg)

	result, _ := tool.Invoke(context.Background(), map[string]any{})
	if !result.IsError {
		t.Error("expected error for missing run_id")
	}
}

// -- GenerateRunID --

func TestGenerateRunID(t *testing.T) {
	id1 := subagent.GenerateRunID()
	id2 := subagent.GenerateRunID()

	if !strings.HasPrefix(id1, "run-") {
		t.Errorf("expected 'run-' prefix, got %q", id1)
	}
	if id1 == id2 {
		t.Error("expected unique IDs")
	}
}
