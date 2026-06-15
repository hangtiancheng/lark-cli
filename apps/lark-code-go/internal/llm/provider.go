package llm

import (
	"context"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// UsageStats 记录单次 LLM 调用的 token 用量
type UsageStats struct {
	InputTokens             int     `json:"input_tokens"`
	OutputTokens            int     `json:"output_tokens"`
	CacheReadInputTokens    int     `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int     `json:"cache_creation_input_tokens"`
	ContextPct              float64 `json:"context_pct"`
}

// ToolCallBlock 表示 LLM 请求调用的一个工具
type ToolCallBlock struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
}

// ThinkingBlock 表示 LLM 的 extended thinking 输出
type ThinkingBlock struct {
	Type      string `json:"type"`
	Thinking  string `json:"thinking"`
	Signature string `json:"signature,omitempty"`
}

// LlmResponse 是 Provider.Chat() 的返回值
type LlmResponse struct {
	StopReason     string          `json:"stop_reason"`
	ToolCalls      []ToolCallBlock `json:"tool_calls"`
	Text           string          `json:"text"`
	Usage          *UsageStats     `json:"usage"`
	ThinkingBlocks []ThinkingBlock `json:"thinking_blocks"`
}

// ChatRequest 是 Provider.Chat() 的请求参数
type ChatRequest struct {
	Messages    []map[string]any `json:"messages"`
	ToolSchemas []map[string]any `json:"tool_schemas"`
	System      string           `json:"system"`
	Step        int              `json:"step"`
	RunID       string           `json:"run_id"`
	Bus         *events.EventBus `json:"-"`
}

// Provider 是 LLM 调用的接口
type Provider interface {
	Chat(ctx context.Context, req *ChatRequest) (*LlmResponse, error)
}
