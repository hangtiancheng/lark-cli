package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/conversation"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/shared"
)

const openaiCompatStreamIdleTimeout = 5 * time.Minute

type openaiCompatClient struct {
	client       openai.Client
	model        string
	systemPrompt string
}

func newOpenAICompatClient(cfg *config.ProviderConfig, systemPrompt string) (*openaiCompatClient, error) {
	apiKey := cfg.ResolveAPIKey()
	if apiKey == "" {
		return nil, &AuthenticationError{
			Message: "OpenAI-compatible API key not found. Set it in .larky/config.yaml or via OPENAI_API_KEY env var.",
		}
	}

	opts := []option.RequestOption{
		option.WithAPIKey(apiKey),
		option.WithBaseURL(cfg.BaseURL),
	}
	if os.Getenv("LARKY_LLM_DEBUG") != "" {
		opts = append(opts, option.WithDebugLog(log.New(os.Stderr, "[llm] ", log.LstdFlags)))
	}
	client := openai.NewClient(opts...)

	return &openaiCompatClient{
		client:       client,
		model:        cfg.Model,
		systemPrompt: systemPrompt,
	}, nil
}

func (c *openaiCompatClient) Stream(ctx context.Context, conv *conversation.Manager, toolSchemas []map[string]any) (<-chan StreamEvent, <-chan error) {
	events := make(chan StreamEvent, 64)
	errs := make(chan error, 1)

	messages := buildChatCompletionMessages(c.systemPrompt, conv.GetMessages())

	var tools []openai.ChatCompletionToolParam
	for _, s := range toolSchemas {
		name, _ := s["name"].(string)
		desc, _ := s["description"].(string)
		params, _ := s["parameters"].(map[string]any)
		tools = append(tools, openai.ChatCompletionToolParam{
			Function: shared.FunctionDefinitionParam{
				Name:        name,
				Description: param.NewOpt(desc),
				Parameters:  shared.FunctionParameters(params),
				Strict:      param.NewOpt(false),
			},
		})
	}

	go func() {
		defer close(events)
		defer close(errs)

		reqParams := openai.ChatCompletionNewParams{
			Model:    c.model,
			Messages: messages,
			StreamOptions: openai.ChatCompletionStreamOptionsParam{
				IncludeUsage: param.NewOpt(true),
			},
		}
		if len(tools) > 0 {
			reqParams.Tools = tools
		}

		stream := c.client.Chat.Completions.NewStreaming(ctx, reqParams)
		defer stream.Close()

		// Track tool calls being assembled across multiple chunks.
		// The Chat Completions API sends tool call information incrementally:
		// the first chunk for a given index carries the ID and function name,
		// subsequent chunks carry argument fragments.
		type toolCallAccum struct {
			id       string
			name     string
			argsJSON string
		}
		toolCalls := make(map[int64]*toolCallAccum)

		// Read SSE events in a separate goroutine so we can respect ctx cancellation
		// and detect silent connection drops, same pattern as the openai Responses client.
		type sseResult struct {
			hasNext bool
		}
		nextCh := make(chan sseResult, 1)

		readNext := func() {
			nextCh <- sseResult{hasNext: stream.Next()}
		}

		idle := time.NewTimer(openaiCompatStreamIdleTimeout)
		defer idle.Stop()

		go readNext()
		for {
			var res sseResult
			select {
			case <-ctx.Done():
				errs <- &NetworkError{Message: fmt.Sprintf("context cancelled: %v", ctx.Err())}
				return
			case <-idle.C:
				errs <- &NetworkError{Message: fmt.Sprintf("stream idle timeout: no SSE events for %s", openaiCompatStreamIdleTimeout)}
				return
			case res = <-nextCh:
			}

			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(openaiCompatStreamIdleTimeout)

			if !res.hasNext {
				break
			}

			chunk := stream.Current()

			// Process choices first. Most providers (OpenAI proper) send choices and
			// the usage-only chunk separately, but some (iFlytek MaaS) put the final
			// finish_reason chunk and usage into the same SSE event — so we must run
			// the choice handler even when usage is present, or tool-call completion
			// gets skipped and the agent loop thinks the turn ended with no tools.
			var finishReason string
			if len(chunk.Choices) > 0 {
				choice := chunk.Choices[0]
				delta := choice.Delta
				finishReason = choice.FinishReason

				if delta.Content != "" {
					events <- TextDelta{Text: delta.Content}
				}

				for _, tc := range delta.ToolCalls {
					acc, exists := toolCalls[tc.Index]
					if !exists {
						acc = &toolCallAccum{}
						toolCalls[tc.Index] = acc
					}
					if tc.ID != "" {
						acc.id = tc.ID
					}
					if tc.Function.Name != "" {
						acc.name = tc.Function.Name
						events <- ToolCallStart{ToolName: acc.name, ToolID: acc.id}
					}
					if tc.Function.Arguments != "" {
						acc.argsJSON += tc.Function.Arguments
						events <- ToolCallDelta{Text: tc.Function.Arguments}
					}
				}

				if finishReason == "tool_calls" || finishReason == "stop" {
					for _, acc := range toolCalls {
						var args map[string]any
						if acc.argsJSON != "" {
							json.Unmarshal([]byte(acc.argsJSON), &args)
						}
						if args == nil {
							args = map[string]any{}
						}
						events <- ToolCallComplete{
							ToolID:    acc.id,
							ToolName:  acc.name,
							Arguments: args,
						}
					}
					toolCalls = make(map[int64]*toolCallAccum)
				}
			}

			// Usage (may be in the same chunk as finish_reason for some providers,
			// or arrive in a trailing usage-only chunk for others).
			if chunk.JSON.Usage.Valid() && chunk.Usage.PromptTokens != 0 {
				cached := int(chunk.Usage.PromptTokensDetails.CachedTokens)
				input := int(chunk.Usage.PromptTokens) - cached
				if input < 0 {
					input = 0
				}
				stopReason := "end_turn"
				if finishReason == "tool_calls" {
					stopReason = "tool_use"
				}
				events <- StreamEnd{
					StopReason: stopReason,
					Usage: UsageInfo{
						InputTokens:     input,
						OutputTokens:    int(chunk.Usage.CompletionTokens),
						CacheReadTokens: cached,
					},
				}
			} else if finishReason == "stop" || finishReason == "tool_calls" {
				// Provider closed the turn without sending usage — emit StreamEnd so
				// the agent loop doesn't hang waiting for one.
				stopReason := "end_turn"
				if finishReason == "tool_calls" {
					stopReason = "tool_use"
				}
				events <- StreamEnd{StopReason: stopReason, Usage: UsageInfo{}}
			}

			go readNext()
		}

		if err := stream.Err(); err != nil {
			errs <- classifyOpenAIError(err)
		}
	}()

	return events, errs
}

// buildChatCompletionMessages converts conversation history into the Chat Completions
// message format. The system prompt becomes a system message at the start. Thinking
// blocks are skipped because Chat Completions does not support them natively.
func buildChatCompletionMessages(systemPrompt string, messages []conversation.Message) []openai.ChatCompletionMessageParamUnion {
	var result []openai.ChatCompletionMessageParamUnion

	// System prompt as the first message
	if systemPrompt != "" {
		result = append(result, openai.SystemMessage(systemPrompt))
	}

	for _, m := range messages {
		if m.Role == "assistant" {
			// ThinkingBlocks are skipped for Chat Completions

			if len(m.ToolUses) > 0 {
				// Assistant message with tool calls
				assistant := openai.ChatCompletionAssistantMessageParam{}
				if m.Content != "" {
					assistant.Content.OfString = param.NewOpt(m.Content)
				}
				for _, tu := range m.ToolUses {
					argsJSON, _ := json.Marshal(tu.Arguments)
					assistant.ToolCalls = append(assistant.ToolCalls, openai.ChatCompletionMessageToolCallParam{
						ID: tu.ToolUseID,
						Function: openai.ChatCompletionMessageToolCallFunctionParam{
							Name:      tu.ToolName,
							Arguments: string(argsJSON),
						},
					})
				}
				result = append(result, openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant})
			} else if m.Content != "" {
				result = append(result, openai.AssistantMessage(m.Content))
			}
		} else if len(m.ToolResults) > 0 {
			// Tool results become individual tool messages
			for _, tr := range m.ToolResults {
				result = append(result, openai.ToolMessage(tr.Content, tr.ToolUseID))
			}
		} else {
			// User messages
			result = append(result, openai.UserMessage(m.Content))
		}
	}

	return result
}
