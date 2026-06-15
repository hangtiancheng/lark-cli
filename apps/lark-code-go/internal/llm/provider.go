package llm

import (
	"context"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// UsageStats records token usage statistics for a single LLM call.
type UsageStats struct {
	InputTokens              int     `json:"input_tokens"`
	OutputTokens             int     `json:"output_tokens"`
	CacheReadInputTokens     int     `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int     `json:"cache_creation_input_tokens"`
	ContextPct               float64 `json:"context_pct"`
}

// ToolCallBlock represents a tool invocation requested by the LLM.
type ToolCallBlock struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
}

// ThinkingBlock represents an extended thinking output block from the LLM.
type ThinkingBlock struct {
	Type      string `json:"type"`
	Thinking  string `json:"thinking"`
	Signature string `json:"signature,omitempty"`
}

// LlmResponse is the return type of Provider.Chat().
type LlmResponse struct {
	StopReason     string          `json:"stop_reason"`
	ToolCalls      []ToolCallBlock `json:"tool_calls"`
	Text           string          `json:"text"`
	Usage          *UsageStats     `json:"usage"`
	ThinkingBlocks []ThinkingBlock `json:"thinking_blocks"`
}

// ChatRequest holds the parameters for a Provider.Chat() call.
type ChatRequest struct {
	Messages    []map[string]any `json:"messages"`
	ToolSchemas []map[string]any `json:"tool_schemas"`
	System      string           `json:"system"`
	Step        int              `json:"step"`
	RunID       string           `json:"run_id"`
	Bus         *events.EventBus `json:"-"`
}

// Provider defines the interface for LLM API interactions.
type Provider interface {
	Chat(ctx context.Context, req *ChatRequest) (*LlmResponse, error)
}
