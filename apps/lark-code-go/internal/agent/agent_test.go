package agent_test

import (
	"context"
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/agent"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// mockProvider is a deterministic LLM provider for testing.
type mockProvider struct {
	responses []*llm.LlmResponse
	callIndex int
}

func (m *mockProvider) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.LlmResponse, error) {
	if m.callIndex >= len(m.responses) {
		return &llm.LlmResponse{
			StopReason: "end_turn",
			Text:       "done",
			Usage:      &llm.UsageStats{ContextPct: 0.1},
		}, nil
	}
	resp := m.responses[m.callIndex]
	m.callIndex++
	return resp, nil
}

// mockTool is a simple test tool.
type mockTool struct {
	name   string
	result string
}

func (t *mockTool) Name() string        { return t.name }
func (t *mockTool) Description() string { return "mock tool: " + t.name }
func (t *mockTool) InputSchema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
}
func (t *mockTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	return &tools.ToolResult{Content: t.result, IsError: false}, nil
}

func TestExecutionContextBasic(t *testing.T) {
	ec := agent.NewExecutionContext("session-1", nil, "You are helpful.")

	if ec.SystemPrompt() != "You are helpful." {
		t.Errorf("expected system prompt 'You are helpful.', got %q", ec.SystemPrompt())
	}

	if ec.Status() != agent.StatusRunning {
		t.Errorf("expected status running, got %s", ec.Status())
	}

	ec.AddUserMessage("hello")
	msgs := ec.Messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0]["role"] != "user" {
		t.Errorf("expected role 'user', got %v", msgs[0]["role"])
	}

	newMsgs := ec.NewMessages()
	if len(newMsgs) != 1 {
		t.Errorf("expected 1 new message, got %d", len(newMsgs))
	}
}

func TestExecutionContextWithExistingMessages(t *testing.T) {
	existing := []map[string]any{
		{"role": "user", "content": "previous"},
		{"role": "assistant", "content": "response"},
	}
	ec := agent.NewExecutionContext("session-1", existing, "system")

	msgs := ec.Messages()
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}

	ec.AddUserMessage("new")
	msgs = ec.Messages()
	if len(msgs) != 3 {
		t.Errorf("expected 3 messages after add, got %d", len(msgs))
	}

	newMsgs := ec.NewMessages()
	if len(newMsgs) != 1 {
		t.Errorf("expected 1 new message, got %d", len(newMsgs))
	}
}

func TestExecutionContextReplaceMessages(t *testing.T) {
	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("msg1")
	ec.AddUserMessage("msg2")

	replacement := []map[string]any{
		{"role": "user", "content": "compacted"},
	}
	ec.ReplaceMessages(replacement)

	msgs := ec.Messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message after replace, got %d", len(msgs))
	}
	if msgs[0]["content"] != "compacted" {
		t.Errorf("expected 'compacted', got %v", msgs[0]["content"])
	}
}

func TestBuildSystemPrompt(t *testing.T) {
	tests := []struct {
		name     string
		global   string
		project  string
		notes    string
		override string
		contains []string
	}{
		{
			name:     "override takes precedence",
			override: "custom prompt",
			contains: []string{"custom prompt"},
		},
		{
			name:     "default with global context",
			global:   "global info",
			contains: []string{"Global Context", "global info"},
		},
		{
			name:     "default with project context",
			project:  "project info",
			contains: []string{"Project Context", "project info"},
		},
		{
			name:     "default with notes",
			notes:    "session notes",
			contains: []string{"Session Notes", "session notes"},
		},
		{
			name:     "default base prompt",
			contains: []string{"helpful AI coding assistant"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			prompt := agent.BuildSystemPrompt(tc.global, tc.project, tc.notes, tc.override)
			for _, s := range tc.contains {
				if !contains(prompt, s) {
					t.Errorf("prompt missing %q: %s", s, prompt)
				}
			}
		})
	}
}

func TestAgentLoopEndTurn(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockProvider{
		responses: []*llm.LlmResponse{
			{
				StopReason: "end_turn",
				Text:       "Hello world",
				Usage:      &llm.UsageStats{ContextPct: 0.1},
			},
		},
	}

	registry := tools.NewRegistry()

	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("hello")

	loopCfg := agent.DefaultLoopConfig()
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	outcome, err := loop.Run(context.Background(), ec, "run-test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Status != agent.StatusSuccess {
		t.Errorf("expected success, got %s", outcome.Status)
	}
	if outcome.Reason != "end_turn" {
		t.Errorf("expected reason 'end_turn', got %s", outcome.Reason)
	}
	if outcome.Steps != 1 {
		t.Errorf("expected 1 step, got %d", outcome.Steps)
	}
	if outcome.Text != "Hello world" {
		t.Errorf("expected text 'Hello world', got %q", outcome.Text)
	}
}

func TestAgentLoopToolUse(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockProvider{
		responses: []*llm.LlmResponse{
			{
				StopReason: "tool_use",
				ToolCalls: []llm.ToolCallBlock{
					{ID: "tc-1", Name: "echo", Input: map[string]any{"msg": "hi"}},
				},
				Usage: &llm.UsageStats{ContextPct: 0.1},
			},
			{
				StopReason: "end_turn",
				Text:       "Tool done",
				Usage:      &llm.UsageStats{ContextPct: 0.1},
			},
		},
	}

	registry := tools.NewRegistry()
	registry.Register(&mockTool{name: "echo", result: "echo: hi"})

	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("use echo tool")

	loopCfg := agent.DefaultLoopConfig()
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	outcome, err := loop.Run(context.Background(), ec, "run-test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Status != agent.StatusSuccess {
		t.Errorf("expected success, got %s", outcome.Status)
	}
	if outcome.Steps != 2 {
		t.Errorf("expected 2 steps, got %d", outcome.Steps)
	}

	// Verify that messages contain the tool_result
	msgs := ec.Messages()
	found := false
	for _, msg := range msgs {
		if content, ok := msg["content"].([]map[string]any); ok {
			for _, block := range content {
				if block["type"] == "tool_result" && block["tool_use_id"] == "tc-1" {
					found = true
				}
			}
		}
	}
	if !found {
		t.Error("expected tool_result in messages")
	}
}

func TestAgentLoopMaxSteps(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	// Provider always requests tool_use, never ends
	provider := &mockProvider{
		responses: make([]*llm.LlmResponse, 5),
	}
	for i := range provider.responses {
		provider.responses[i] = &llm.LlmResponse{
			StopReason: "tool_use",
			ToolCalls: []llm.ToolCallBlock{
				{ID: "tc-" + string(rune('0'+i)), Name: "noop", Input: map[string]any{}},
			},
			Usage: &llm.UsageStats{ContextPct: 0.1},
		}
	}

	registry := tools.NewRegistry()
	registry.Register(&mockTool{name: "noop", result: "ok"})

	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("loop forever")

	loopCfg := &agent.LoopConfig{
		MaxSteps:         3,
		CompactThreshold: 0.8,
	}
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	outcome, _ := loop.Run(context.Background(), ec, "run-test")
	if outcome.Status != agent.StatusFailed {
		t.Errorf("expected failed, got %s", outcome.Status)
	}
	if outcome.Reason != "exceeded_max_steps" {
		t.Errorf("expected reason 'exceeded_max_steps', got %s", outcome.Reason)
	}
	if outcome.Steps != 3 {
		t.Errorf("expected 3 steps, got %d", outcome.Steps)
	}
}

func TestAgentLoopMaxTokens(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockProvider{
		responses: []*llm.LlmResponse{
			{
				StopReason: "max_tokens",
				ToolCalls: []llm.ToolCallBlock{
					{ID: "tc-1", Name: "echo", Input: map[string]any{}},
				},
				Usage: &llm.UsageStats{ContextPct: 0.95},
			},
			{
				StopReason: "end_turn",
				Text:       "recovered",
				Usage:      &llm.UsageStats{ContextPct: 0.2},
			},
		},
	}

	registry := tools.NewRegistry()
	registry.Register(&mockTool{name: "echo", result: "ok"})

	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("test max_tokens")

	loopCfg := agent.DefaultLoopConfig()
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	outcome, err := loop.Run(context.Background(), ec, "run-test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Status != agent.StatusSuccess {
		t.Errorf("expected success after max_tokens recovery, got %s", outcome.Status)
	}
	if outcome.Steps != 2 {
		t.Errorf("expected 2 steps, got %d", outcome.Steps)
	}
}

func TestAgentLoopCancellation(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	// Provider that blocks until context is cancelled
	provider := &mockBlockingProvider{}

	registry := tools.NewRegistry()
	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("cancel me")

	loopCfg := agent.DefaultLoopConfig()
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		outcome, _ := loop.Run(ctx, ec, "run-cancel")
		if outcome.Status != agent.StatusCanceled {
			t.Errorf("expected canceled, got %s", outcome.Status)
		}
		close(done)
	}()

	cancel()
	<-done
}

func TestAgentLoopEventPublishing(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	provider := &mockProvider{
		responses: []*llm.LlmResponse{
			{
				StopReason: "end_turn",
				Text:       "done",
				Usage:      &llm.UsageStats{ContextPct: 0.1},
			},
		},
	}

	registry := tools.NewRegistry()
	ec := agent.NewExecutionContext("session-1", nil, "system")
	ec.AddUserMessage("test events")

	loopCfg := agent.DefaultLoopConfig()
	loop := agent.NewAgentLoop(loopCfg, provider, registry, eb, nil)

	loop.Run(context.Background(), ec, "run-events")

	// Use blocking receive with timeout to collect all events
	var eventTypes []string
	timeout := time.After(2 * time.Second)
	for {
		select {
		case evt := <-ch:
			eventTypes = append(eventTypes, evt.EventType())
		case <-timeout:
			goto check
		}
	}

check:
	expected := []string{"run.started", "step.started", "step.finished", "run.finished"}
	for _, exp := range expected {
		found := false
		for _, got := range eventTypes {
			if got == exp {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing event %q, got: %v", exp, eventTypes)
		}
	}
}

// mockBlockingProvider blocks until the context is cancelled.
type mockBlockingProvider struct{}

func (m *mockBlockingProvider) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.LlmResponse, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

// contains checks whether s contains substr.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
