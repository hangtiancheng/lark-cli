package compact_test

import (
	"context"
	"strings"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/compact"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
)

// mockCompactProvider 返回固定摘要文本
type mockCompactProvider struct {
	summary string
	err     error
}

func (m *mockCompactProvider) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.LlmResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &llm.LlmResponse{
		StopReason: "end_turn",
		Text:       m.summary,
		Usage:      &llm.UsageStats{ContextPct: 0.1},
	}, nil
}

func TestCompactorCompact(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockCompactProvider{
		summary: "## Key Decisions\n- Decision 1\n## Actions Taken\n- Action 1",
	}

	compactor := compact.NewCompactor(provider, eb)

	messages := []map[string]any{
		{"role": "user", "content": "Hello, can you help me with this task?"},
		{"role": "assistant", "content": "Sure, I'll help you with that."},
		{"role": "user", "content": "Great, please proceed with the implementation."},
		{"role": "assistant", "content": "I've completed the implementation."},
	}

	compacted, origTokens, summaryTokens, err := compactor.Compact(
		context.Background(), messages, "session-1", "run-1", "",
	)
	if err != nil {
		t.Fatalf("Compact failed: %v", err)
	}

	if len(compacted) != 2 {
		t.Fatalf("expected 2 compacted messages, got %d", len(compacted))
	}

	if compacted[0]["role"] != "user" {
		t.Errorf("expected first role 'user', got %v", compacted[0]["role"])
	}
	if !strings.Contains(compacted[0]["content"].(string), "summarized") {
		t.Errorf("expected summary marker in first message, got %q", compacted[0]["content"])
	}

	if compacted[1]["role"] != "assistant" {
		t.Errorf("expected second role 'assistant', got %v", compacted[1]["role"])
	}
	if !strings.Contains(compacted[1]["content"].(string), "Key Decisions") {
		t.Errorf("expected summary content, got %q", compacted[1]["content"])
	}

	if origTokens <= 0 {
		t.Errorf("expected positive original tokens, got %d", origTokens)
	}
	if summaryTokens <= 0 {
		t.Errorf("expected positive summary tokens, got %d", summaryTokens)
	}
}

func TestCompactorWithFocus(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockCompactProvider{summary: "focused summary"}
	compactor := compact.NewCompactor(provider, eb)

	messages := []map[string]any{
		{"role": "user", "content": "task description"},
	}

	_, _, _, err := compactor.Compact(
		context.Background(), messages, "session-1", "run-1", "security concerns",
	)
	if err != nil {
		t.Fatalf("Compact with focus failed: %v", err)
	}
}

func TestCompactorLLMError(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockCompactProvider{
		err: context.DeadlineExceeded,
	}
	compactor := compact.NewCompactor(provider, eb)

	messages := []map[string]any{
		{"role": "user", "content": "hello"},
	}

	_, _, _, err := compactor.Compact(
		context.Background(), messages, "session-1", "run-1", "",
	)
	if err == nil {
		t.Error("expected error when LLM call fails")
	}
}

func TestCompactorEventPublishing(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	provider := &mockCompactProvider{summary: "summary"}
	compactor := compact.NewCompactor(provider, eb)

	messages := []map[string]any{
		{"role": "user", "content": "hello"},
		{"role": "assistant", "content": "hi"},
	}

	compactor.Compact(context.Background(), messages, "session-1", "run-1", "")

	// 应该发布 context.compacted 事件
	found := false
	timeout := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			select {
			case evt := <-ch:
				if evt.EventType() == "context.compacted" {
					found = true
					close(timeout)
					return
				}
			default:
			}
		}
		close(timeout)
	}()
	<-timeout

	if !found {
		t.Error("expected context.compacted event")
	}
}

func TestCompactorWithArrayContent(t *testing.T) {
	eb := events.NewEventBus()
	defer eb.Close()

	provider := &mockCompactProvider{summary: "summary"}
	compactor := compact.NewCompactor(provider, eb)

	messages := []map[string]any{
		{"role": "user", "content": "simple text"},
		{
			"role": "assistant",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "I'll use a tool",
				},
			},
		},
	}

	compacted, origTokens, _, err := compactor.Compact(
		context.Background(), messages, "session-1", "run-1", "",
	)
	if err != nil {
		t.Fatalf("Compact with array content failed: %v", err)
	}
	if len(compacted) != 2 {
		t.Errorf("expected 2 compacted messages, got %d", len(compacted))
	}
	if origTokens <= 0 {
		t.Errorf("expected positive original tokens, got %d", origTokens)
	}
}

func TestTruncateToolResultsNoTruncation(t *testing.T) {
	messages := []map[string]any{
		{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"tool_use_id": "tool-use-1",
					"content":     "short content",
				},
			},
		},
	}

	result := compact.TruncateToolResults(messages, 1000, 100)
	if len(result) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result))
	}

	blocks, ok := result[0]["content"].([]any)
	if !ok {
		t.Fatal("expected content to be array")
	}
	block := blocks[0].(map[string]any)
	if block["content"] != "short content" {
		t.Errorf("content should not be truncated, got %v", block["content"])
	}
}

func TestTruncateToolResultsWithStringContent(t *testing.T) {
	longContent := make([]byte, 2000)
	for i := range longContent {
		longContent[i] = 'x'
	}

	messages := []map[string]any{
		{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"tool_use_id": "tool-use-1",
					"content":     string(longContent),
				},
			},
		},
	}

	result := compact.TruncateToolResults(messages, 100, 50)
	if len(result) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result))
	}

	blocks := result[0]["content"].([]any)
	block := blocks[0].(map[string]any)
	content := block["content"].(string)

	if len(content) >= 2000 {
		t.Errorf("expected truncated content, got length %d", len(content))
	}
	if len(content) < 50 {
		t.Errorf("truncated content too short: %d chars", len(content))
	}
}

func TestTruncateToolResultsWithArrayContent(t *testing.T) {
	longText := make([]byte, 2000)
	for i := range longText {
		longText[i] = 'y'
	}

	messages := []map[string]any{
		{
			"role": "user",
			"content": []any{
				map[string]any{
					"type":        "tool_result",
					"tool_use_id": "tool-use-1",
					"content": []any{
						map[string]any{
							"type": "text",
							"text": string(longText),
						},
					},
				},
			},
		},
	}

	result := compact.TruncateToolResults(messages, 100, 50)
	blocks := result[0]["content"].([]any)
	block := blocks[0].(map[string]any)
	innerBlocks := block["content"].([]any)
	innerBlock := innerBlocks[0].(map[string]any)
	text := innerBlock["text"].(string)

	if len(text) >= 2000 {
		t.Errorf("expected truncated text, got length %d", len(text))
	}
}

func TestTruncateToolResultsPreservesNonToolResult(t *testing.T) {
	messages := []map[string]any{
		{
			"role":    "user",
			"content": "plain text message",
		},
		{
			"role": "assistant",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "assistant response",
				},
			},
		},
	}

	result := compact.TruncateToolResults(messages, 10, 5)
	if len(result) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(result))
	}
	if result[0]["content"] != "plain text message" {
		t.Error("plain text message should not be modified")
	}
}

func TestTruncateToolResultsZeroLimit(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "test"},
	}

	result := compact.TruncateToolResults(messages, 0, 0)
	if len(result) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result))
	}
}
