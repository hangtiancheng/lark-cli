package llm_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/trace"
)

// mockProvider returns deterministic responses.
type mockProvider struct {
	resp *llm.LlmResponse
	err  error
}

func (m *mockProvider) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.LlmResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

func TestTracingProviderSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	tracePath := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(tracePath)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	inner := &mockProvider{
		resp: &llm.LlmResponse{
			StopReason: "end_turn",
			Text:       "hello world",
			Usage: &llm.UsageStats{
				InputTokens:  100,
				OutputTokens: 50,
				ContextPct:   0.1,
			},
		},
	}

	tp := llm.NewTracingProvider(inner, w, false)

	resp, err := tp.Chat(context.Background(), &llm.ChatRequest{
		Messages: []map[string]any{{"role": "user", "content": "hi"}},
		System:   "system prompt",
		RunID:    "run-1",
		Step:     1,
	})
	if err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if resp.StopReason != "end_turn" {
		t.Errorf("expected end_turn, got %s", resp.StopReason)
	}
	if resp.Text != "hello world" {
		t.Errorf("expected 'hello world', got %q", resp.Text)
	}

	w.Stop()

	// Verify the trace file contains both request and response records.
	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("failed to read trace: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 trace lines, got %d", len(lines))
	}

	var reqRec map[string]any
	json.Unmarshal([]byte(lines[0]), &reqRec)
	if reqRec["direction"] != "out" {
		t.Errorf("expected direction 'out' for request, got %v", reqRec["direction"])
	}
	if reqRec["kind"] != "request" {
		t.Errorf("expected kind 'request', got %v", reqRec["kind"])
	}

	var respRec map[string]any
	json.Unmarshal([]byte(lines[1]), &respRec)
	if respRec["direction"] != "in" {
		t.Errorf("expected direction 'in' for response, got %v", respRec["direction"])
	}
	if respRec["kind"] != "response" {
		t.Errorf("expected kind 'response', got %v", respRec["kind"])
	}
}

func TestTracingProviderError(t *testing.T) {
	tmpDir := t.TempDir()
	tracePath := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(tracePath)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	inner := &mockProvider{
		err: context.DeadlineExceeded,
	}

	tp := llm.NewTracingProvider(inner, w, false)

	_, err = tp.Chat(context.Background(), &llm.ChatRequest{
		Messages: []map[string]any{{"role": "user", "content": "hi"}},
		RunID:    "run-1",
		Step:     1,
	})
	if err == nil {
		t.Fatal("expected error")
	}

	w.Stop()

	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("failed to read trace: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 trace lines (request + error), got %d", len(lines))
	}

	var errRec map[string]any
	json.Unmarshal([]byte(lines[1]), &errRec)
	if errRec["kind"] != "error" {
		t.Errorf("expected kind 'error', got %v", errRec["kind"])
	}
}

func TestTracingProviderIncludePayload(t *testing.T) {
	tmpDir := t.TempDir()
	tracePath := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(tracePath)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	inner := &mockProvider{
		resp: &llm.LlmResponse{
			StopReason: "end_turn",
			Text:       "response text",
		},
	}

	tp := llm.NewTracingProvider(inner, w, true) // includePayload=true

	tp.Chat(context.Background(), &llm.ChatRequest{
		Messages: []map[string]any{{"role": "user", "content": "hi"}},
		System:   "system prompt",
		RunID:    "run-1",
		Step:     1,
	})

	w.Stop()

	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("failed to read trace: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")

	var reqRec map[string]any
	json.Unmarshal([]byte(lines[0]), &reqRec)

	// includePayload=true should include the system field.
	reqData, _ := reqRec["data"].(map[string]any)
	if _, ok := reqData["system"]; !ok {
		t.Error("expected 'system' in request data when includePayload=true")
	}

	var respRec map[string]any
	json.Unmarshal([]byte(lines[1]), &respRec)
	respData, _ := respRec["data"].(map[string]any)
	if _, ok := respData["text"]; !ok {
		t.Error("expected 'text' in response data when includePayload=true")
	}
}

func TestTracingProviderExcludePayload(t *testing.T) {
	tmpDir := t.TempDir()
	tracePath := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(tracePath)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	inner := &mockProvider{
		resp: &llm.LlmResponse{
			StopReason: "end_turn",
			Text:       "response text",
		},
	}

	tp := llm.NewTracingProvider(inner, w, false) // includePayload=false

	tp.Chat(context.Background(), &llm.ChatRequest{
		Messages: []map[string]any{{"role": "user", "content": "hi"}},
		System:   "system prompt",
		RunID:    "run-1",
		Step:     1,
	})

	w.Stop()

	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatalf("failed to read trace: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")

	var reqRec map[string]any
	json.Unmarshal([]byte(lines[0]), &reqRec)

	reqData, _ := reqRec["data"].(map[string]any)
	if _, ok := reqData["system"]; ok {
		t.Error("should NOT include 'system' when includePayload=false")
	}
}
