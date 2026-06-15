package tools_test

import (
	"context"
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// mockToolForInvocation is a controllable test tool
type mockToolForInvocation struct {
	name    string
	result  string
	isError bool
	delay   time.Duration
}

func (t *mockToolForInvocation) Name() string        { return t.name }
func (t *mockToolForInvocation) Description() string { return "mock: " + t.name }
func (t *mockToolForInvocation) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}
func (t *mockToolForInvocation) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	if t.delay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(t.delay):
		}
	}
	return &tools.ToolResult{
		Content:   t.result,
		IsError:   t.isError,
		ErrorType: tools.ErrorTypeRuntime,
	}, nil
}

func TestInvokeToolSuccess(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	reg := tools.NewRegistry()
	reg.Register(&mockToolForInvocation{name: "echo", result: "hello"})

	result := tools.InvokeTool(context.Background(), reg, "tc-1", "echo", map[string]any{"msg": "hi"}, eb, "run-1")
	if result.IsError {
		t.Errorf("expected success, got error: %s", result.Content)
	}
	if result.Content != "hello" {
		t.Errorf("expected 'hello', got %q", result.Content)
	}
}

func TestInvokeToolUnknownTool(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	reg := tools.NewRegistry()

	result := tools.InvokeTool(context.Background(), reg, "tc-1", "nonexistent", map[string]any{}, eb, "run-1")
	if !result.IsError {
		t.Error("expected error for unknown tool")
	}
	if result.ErrorType != tools.ErrorTypeRuntime {
		t.Errorf("expected runtime error, got %s", result.ErrorType)
	}
}

func TestInvokeToolRetry(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	// First call fails, second succeeds
	callCount := 0
	reg := tools.NewRegistry()

	retryTool := &retryCountTool{
		name:      "flaky",
		failTimes: 1,
		callCount: &callCount,
	}
	reg.Register(retryTool)

	result := tools.InvokeTool(context.Background(), reg, "tc-1", "flaky", map[string]any{}, eb, "run-1")
	if result.IsError {
		t.Errorf("expected success after retry, got error: %s", result.Content)
	}
	if callCount != 2 {
		t.Errorf("expected 2 calls (1 fail + 1 success), got %d", callCount)
	}
}

func TestInvokeToolRetryExhausted(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	callCount := 0
	reg := tools.NewRegistry()

	alwaysFailTool := &alwaysFailTool{name: "broken", callCount: &callCount}
	reg.Register(alwaysFailTool)

	result := tools.InvokeTool(context.Background(), reg, "tc-1", "broken", map[string]any{}, eb, "run-1")
	if !result.IsError {
		t.Error("expected error after all retries exhausted")
	}
	// 1 initial + 2 retries = 3 calls
	if callCount != 3 {
		t.Errorf("expected 3 calls, got %d", callCount)
	}
}

func TestInvokeToolNonRetryableError(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	callCount := 0
	reg := tools.NewRegistry()

	nonRetryTool := &nonRetryableErrorTool{name: "schema_fail", callCount: &callCount}
	reg.Register(nonRetryTool)

	result := tools.InvokeTool(context.Background(), reg, "tc-1", "schema_fail", map[string]any{}, eb, "run-1")
	if !result.IsError {
		t.Error("expected error for non-retryable tool")
	}
	if result.ErrorType != tools.ErrorTypeSchema {
		t.Errorf("expected schema error, got %s", result.ErrorType)
	}
	// schema_error is not retryable, should only be called once
	if callCount != 1 {
		t.Errorf("expected 1 call (no retry for schema_error), got %d", callCount)
	}
}

func TestInvokeToolEventPublishing(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	reg := tools.NewRegistry()
	reg.Register(&mockToolForInvocation{name: "echo", result: "ok"})

	tools.InvokeTool(context.Background(), reg, "tc-1", "echo", map[string]any{}, eb, "run-1")

	// Should have tool.call_started and tool.call_finished events
	eventTypes := drainEvents(ch, 5)

	hasStarted := false
	hasFinished := false
	for _, et := range eventTypes {
		if et == "tool.call_started" {
			hasStarted = true
		}
		if et == "tool.call_finished" {
			hasFinished = true
		}
	}
	if !hasStarted {
		t.Error("missing tool.call_started event")
	}
	if !hasFinished {
		t.Error("missing tool.call_finished event")
	}
}

func TestInvokeToolFailureEvent(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	reg := tools.NewRegistry()
	reg.Register(&mockToolForInvocation{name: "fail", result: "oops", isError: true})

	tools.InvokeTool(context.Background(), reg, "tc-1", "fail", map[string]any{}, eb, "run-1")

	eventTypes := drainEvents(ch, 10)

	hasFailed := false
	for _, et := range eventTypes {
		if et == "tool.call_failed" {
			hasFailed = true
		}
	}
	if !hasFailed {
		t.Error("missing tool.call_failed event")
	}
}

// -- Helper tool types --

type retryCountTool struct {
	name      string
	failTimes int
	callCount *int
}

func (t *retryCountTool) Name() string        { return t.name }
func (t *retryCountTool) Description() string { return "retry test" }
func (t *retryCountTool) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}
func (t *retryCountTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	*t.callCount++
	if *t.callCount <= t.failTimes {
		return &tools.ToolResult{Content: "error", IsError: true, ErrorType: tools.ErrorTypeRuntime}, nil
	}
	return &tools.ToolResult{Content: "success", IsError: false}, nil
}

type alwaysFailTool struct {
	name      string
	callCount *int
}

func (t *alwaysFailTool) Name() string        { return t.name }
func (t *alwaysFailTool) Description() string { return "always fail" }
func (t *alwaysFailTool) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}
func (t *alwaysFailTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	*t.callCount++
	return &tools.ToolResult{Content: "fail", IsError: true, ErrorType: tools.ErrorTypeRuntime}, nil
}

type nonRetryableErrorTool struct {
	name      string
	callCount *int
}

func (t *nonRetryableErrorTool) Name() string        { return t.name }
func (t *nonRetryableErrorTool) Description() string { return "schema error" }
func (t *nonRetryableErrorTool) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}
func (t *nonRetryableErrorTool) Invoke(ctx context.Context, params map[string]any) (*tools.ToolResult, error) {
	*t.callCount++
	return &tools.ToolResult{Content: "bad schema", IsError: true, ErrorType: tools.ErrorTypeSchema}, nil
}

func drainEvents(ch <-chan bus.Event, max int) []string {
	var types []string
	for i := 0; i < max; i++ {
		select {
		case evt := <-ch:
			types = append(types, evt.EventType())
		default:
			return types
		}
	}
	return types
}
