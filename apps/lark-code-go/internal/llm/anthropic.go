package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

const (
	maxStreamRetries = 3
	defaultMaxTokens = 16384
)

var retryBackoff = [3]time.Duration{
	time.Second,
	2 * time.Second,
	4 * time.Second,
}

// modelContextWindows maps model identifiers to their context window sizes.
var modelContextWindows = map[string]int{
	"claude-sonnet-4-6":          200_000,
	"claude-opus-4-6":            200_000,
	"claude-haiku-4-5-20251001":  200_000,
	"claude-3-5-sonnet-20241022": 200_000,
	"claude-3-5-haiku-20241022":  200_000,
	"claude-3-opus-20240229":     200_000,
}

// AnthropicProvider implements the Provider interface using the Anthropic SDK to call Claude models.
type AnthropicProvider struct {
	model  string
	client *anthropic.Client
}

// NewAnthropicProvider creates a new AnthropicProvider for the specified model.
func NewAnthropicProvider(model string, opts ...option.RequestOption) *AnthropicProvider {
	client := anthropic.NewClient(opts...)
	return &AnthropicProvider{
		model:  model,
		client: &client,
	}
}

// Chat invokes the Anthropic API for a streaming conversation.
func (p *AnthropicProvider) Chat(ctx context.Context, req *ChatRequest) (*LlmResponse, error) {
	// Publish the model selection event.
	if req.Bus != nil {
		req.Bus.Publish(&bus.LlmModelSelectedEvent{
			Type:     "llm.model_selected",
			RunID:    req.RunID,
			Model:    p.model,
			Strategy: "static",
			TS:       time.Now().UTC().Format(time.RFC3339),
		})
	}

	// Build system prompt blocks.
	var systemBlocks []anthropic.TextBlockParam
	if req.System != "" {
		systemBlocks = append(systemBlocks, anthropic.TextBlockParam{
			Type:         "text",
			Text:         req.System,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		})
	}

	// Convert raw messages to Anthropic format.
	messages := make([]anthropic.MessageParam, 0, len(req.Messages))
	for _, msg := range req.Messages {
		mp, err := convertMessageParam(msg)
		if err != nil {
			return nil, fmt.Errorf("failed to convert message: %w", err)
		}
		messages = append(messages, mp)
	}

	// Convert tool schemas to Anthropic format.
	tools := convertToolSchemas(req.ToolSchemas)

	// Assemble the request parameters.
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(p.model),
		MaxTokens: defaultMaxTokens,
		Messages:  messages,
		System:    systemBlocks,
		Tools:     tools,
	}

	// Retry loop with exponential backoff.
	var lastErr error
	for attempt := 0; attempt <= maxStreamRetries; attempt++ {
		resp, err := p.doStream(ctx, req, params, attempt == 0)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		slog.Warn("anthropic stream error, retrying",
			"attempt", attempt+1,
			"error", err)

		if attempt < maxStreamRetries {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(retryBackoff[attempt]):
			}
		}
	}

	return nil, fmt.Errorf("anthropic stream failed after %d retries: %w", maxStreamRetries, lastErr)
}

// doStream performs a single streaming API request.
func (p *AnthropicProvider) doStream(
	ctx context.Context,
	req *ChatRequest,
	params anthropic.MessageNewParams,
	publishTokens bool,
) (*LlmResponse, error) {
	stream := p.client.Messages.NewStreaming(ctx, params)
	defer func() {
		_ = stream.Close()
	}()

	// Accumulate the complete message from stream events.
	accumulated := anthropic.Message{}
	now := time.Now().UTC().Format(time.RFC3339)

	for stream.Next() {
		event := stream.Current()

		if err := accumulated.Accumulate(event); err != nil {
			slog.Warn("failed to accumulate stream event", "error", err)
		}

		// Publish token events during streaming (first attempt only).
		if publishTokens {
			if delta := event.AsContentBlockDelta(); delta.Delta.Type == "text_delta" {
				text := delta.Delta.Text
				if text != "" && req.Bus != nil {
					req.Bus.Publish(&bus.LlmTokenEvent{
						Type:  "llm.token",
						RunID: req.RunID,
						Token: text,
						TS:    now,
					})
				}
			}
		}
	}

	if err := stream.Err(); err != nil {
		return nil, err
	}

	// Extract the response result.
	resp := &LlmResponse{
		StopReason: string(accumulated.StopReason),
		Text:       "",
		Usage:      &UsageStats{},
	}

	// Extract token usage statistics.
	resp.Usage.InputTokens = int(accumulated.Usage.InputTokens)
	resp.Usage.OutputTokens = int(accumulated.Usage.OutputTokens)
	resp.Usage.CacheReadInputTokens = int(accumulated.Usage.CacheReadInputTokens)
	resp.Usage.CacheCreationInputTokens = int(accumulated.Usage.CacheCreationInputTokens)

	// Calculate context window utilization percentage.
	if ctxWindow, ok := modelContextWindows[p.model]; ok && ctxWindow > 0 {
		resp.Usage.ContextPct = float64(resp.Usage.InputTokens) / float64(ctxWindow)
	}

	// Publish the usage event.
	if req.Bus != nil {
		req.Bus.Publish(&bus.LlmUsageEvent{
			Type:                     "llm.usage",
			RunID:                    req.RunID,
			InputTokens:              resp.Usage.InputTokens,
			OutputTokens:             resp.Usage.OutputTokens,
			CacheReadInputTokens:     resp.Usage.CacheReadInputTokens,
			CacheCreationInputTokens: resp.Usage.CacheCreationInputTokens,
			ContextPct:               resp.Usage.ContextPct,
			TS:                       now,
		})
	}

	// Parse content blocks from the accumulated response.
	for _, block := range accumulated.Content {
		switch b := block.AsAny().(type) {
		case anthropic.TextBlock:
			resp.Text += b.Text
		case anthropic.ToolUseBlock:
			var input map[string]any
			if len(b.Input) > 0 {
				if err := json.Unmarshal(b.Input, &input); err != nil {
					input = map[string]any{}
				}
			}
			resp.ToolCalls = append(resp.ToolCalls, ToolCallBlock{
				ID:    b.ID,
				Name:  b.Name,
				Input: input,
			})
		case anthropic.ThinkingBlock:
			resp.ThinkingBlocks = append(resp.ThinkingBlocks, ThinkingBlock{
				Type:      string(b.Type),
				Thinking:  b.Thinking,
				Signature: b.Signature,
			})
		}
	}

	return resp, nil
}

// convertMessageParam converts a raw map to an anthropic.MessageParam.
func convertMessageParam(msg map[string]any) (anthropic.MessageParam, error) {
	data, err := json.Marshal(msg)
	if err != nil {
		return anthropic.MessageParam{}, err
	}
	var mp anthropic.MessageParam
	if err := json.Unmarshal(data, &mp); err != nil {
		return anthropic.MessageParam{}, err
	}
	return mp, nil
}

// convertToolSchemas converts raw tool schema maps to anthropic.ToolUnionParam slices.
func convertToolSchemas(schemas []map[string]any) []anthropic.ToolUnionParam {
	tools := make([]anthropic.ToolUnionParam, 0, len(schemas))
	for _, schema := range schemas {
		name, _ := schema["name"].(string)
		desc, _ := schema["description"].(string)
		inputSchema, _ := schema["input_schema"].(map[string]any)

		tool := anthropic.ToolUnionParam{
			OfTool: &anthropic.ToolParam{
				Name:        name,
				Description: param.NewOpt(desc),
				InputSchema: convertInputSchema(inputSchema),
			},
		}

		tools = append(tools, tool)
	}
	return tools
}

// convertInputSchema converts a raw map to an anthropic.ToolInputSchemaParam.
func convertInputSchema(schema map[string]any) anthropic.ToolInputSchemaParam {
	if schema == nil {
		return anthropic.ToolInputSchemaParam{
			Type: "object",
		}
	}

	result := anthropic.ToolInputSchemaParam{
		Type: "object",
	}

	if props, ok := schema["properties"].(map[string]any); ok {
		result.Properties = props
	}

	if required, ok := schema["required"].([]any); ok {
		for _, r := range required {
			if s, ok := r.(string); ok {
				result.Required = append(result.Required, s)
			}
		}
	}

	return result
}
