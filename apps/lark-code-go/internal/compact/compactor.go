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

// Compactor uses an LLM to compact and summarize conversation context.
type Compactor struct {
	provider llm.Provider
	bus      *events.EventBus
}

// NewCompactor creates a new Compactor instance.
func NewCompactor(provider llm.Provider, busInst *events.EventBus) *Compactor {
	return &Compactor{
		provider: provider,
		bus:      busInst,
	}
}

// Compact compacts conversation messages by summarizing them with an LLM.
// It returns the compacted messages, original token count, summary token count, and any error.
func (c *Compactor) Compact(
	ctx context.Context,
	messages []map[string]any,
	sessionID string,
	runID string,
	focus string,
) ([]map[string]any, int, int, error) {
	// Build the compaction request
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

	// Estimate token count (rough approximation: 4 chars ≈ 1 token)
	originalTokens := estimateTokens(messages)
	summaryTokens := len(resp.Text) / 4

	// Build the compacted messages
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

	// Publish the compaction event
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

// extractText extracts plain text from message content, which may be a string or an array of blocks.
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

// estimateTokens roughly estimates the token count of messages using a 4-chars-per-token heuristic.
func estimateTokens(messages []map[string]any) int {
	total := 0
	for _, msg := range messages {
		text := extractText(msg["content"])
		total += len(text) / 4
	}
	return total
}
