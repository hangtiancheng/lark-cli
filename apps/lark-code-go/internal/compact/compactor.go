package compact

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
)

const compactSystemPrompt = `You are a conversation compactor. Summarize the conversation into a structured summary with these sections:

## Key Decisions
## Actions Taken
## Current State
## Pending Items
## Important Context
## Tool Results Summary

Be concise but preserve all critical information. Focus on what the assistant learned and decided, not the process.`

// Compactor 使用 LLM 进行上下文压缩
type Compactor struct {
	provider llm.Provider
	bus      *events.EventBus
}

// NewCompactor 创建压缩器
func NewCompactor(provider llm.Provider, busInst *events.EventBus) *Compactor {
	return &Compactor{
		provider: provider,
		bus:      busInst,
	}
}

// Compact 压缩对话消息
func (c *Compactor) Compact(
	ctx context.Context,
	messages []map[string]any,
	sessionID string,
	runID string,
	focus string,
) ([]map[string]any, int, int, error) {
	// 构造压缩请求
	var userContent strings.Builder
	userContent.WriteString("Summarize the following conversation")
	if focus != "" {
		userContent.WriteString(fmt.Sprintf(", focusing on: %s", focus))
	}
	userContent.WriteString(":\n\n")

	for _, msg := range messages {
		role, _ := msg["role"].(string)
		userContent.WriteString(fmt.Sprintf("## %s\n", role))
		content := extractText(msg["content"])
		userContent.WriteString(content)
		userContent.WriteString("\n\n")
	}

	compactMessages := []map[string]any{
		{
			"role":    "user",
			"content": userContent.String(),
		},
	}

	req := &llm.ChatRequest{
		Messages: compactMessages,
		System:   compactSystemPrompt,
		RunID:    runID,
		Bus:      c.bus,
	}

	resp, err := c.provider.Chat(ctx, req)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("compaction LLM call failed: %w", err)
	}

	// 估算 token 数（粗略：4 字符 ≈ 1 token）
	originalTokens := estimateTokens(messages)
	summaryTokens := len(resp.Text) / 4

	// 构造压缩后的消息
	compacted := []map[string]any{
		{
			"role":    "user",
			"content": "[Previous conversation summarized below]",
		},
		{
			"role":    "assistant",
			"content": resp.Text,
		},
	}

	// 发布压缩事件
	c.bus.Publish(&bus.ContextCompactedEvent{
		Type:           "context.compacted",
		SessionID:      sessionID,
		RunID:          runID,
		OriginalTokens: originalTokens,
		SummaryTokens:  summaryTokens,
		TS:             time.Now().UTC().Format(time.RFC3339),
	})

	return compacted, originalTokens, summaryTokens, nil
}

// extractText 从消息内容中提取纯文本
func extractText(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case []any:
		var parts []string
		for _, block := range c {
			if m, ok := block.(map[string]any); ok {
				if t, ok := m["type"].(string); ok && t == "text" {
					if text, ok := m["text"].(string); ok {
						parts = append(parts, text)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

// estimateTokens 粗略估算消息的 token 数
func estimateTokens(messages []map[string]any) int {
	total := 0
	for _, msg := range messages {
		text := extractText(msg["content"])
		total += len(text) / 4
	}
	return total
}
