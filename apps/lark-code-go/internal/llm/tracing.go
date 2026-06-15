package llm

import (
	"context"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/trace"
)

// TracingProvider 包装 Provider，记录请求和响应到 TraceWriter
type TracingProvider struct {
	inner           Provider
	writer          *trace.Writer
	includePayload  bool
}

// NewTracingProvider 创建 TracingProvider
func NewTracingProvider(inner Provider, writer *trace.Writer, includePayload bool) *TracingProvider {
	return &TracingProvider{
		inner:          inner,
		writer:         writer,
		includePayload: includePayload,
	}
}

// Chat 调用内部 Provider 并记录追踪数据
func (p *TracingProvider) Chat(ctx context.Context, req *ChatRequest) (*LlmResponse, error) {
	start := time.Now()

	// 记录请求
	p.writer.Write(trace.Record{
		TS:        start.UTC().Format(time.RFC3339Nano),
		Direction: "out",
		Layer:     "llm",
		Kind:      "request",
		RunID:     req.RunID,
		Step:      req.Step,
		Data:      p.requestData(req),
	})

	resp, err := p.inner.Chat(ctx, req)

	elapsed := time.Since(start)

	if err != nil {
		p.writer.Write(trace.Record{
			TS:        time.Now().UTC().Format(time.RFC3339Nano),
			Direction: "in",
			Layer:     "llm",
			Kind:      "error",
			RunID:     req.RunID,
			Step:      req.Step,
			Data: map[string]any{
				"error":      err.Error(),
				"elapsed_ms": elapsed.Milliseconds(),
			},
		})
		return nil, err
	}

	// 记录响应
	p.writer.Write(trace.Record{
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Direction: "in",
		Layer:     "llm",
		Kind:      "response",
		RunID:     req.RunID,
		Step:      req.Step,
		Data:      p.responseData(resp, elapsed),
	})

	return resp, nil
}

// requestData 提取请求数据用于追踪
func (p *TracingProvider) requestData(req *ChatRequest) map[string]any {
	data := map[string]any{
		"step":         req.Step,
		"msg_count":    len(req.Messages),
		"tool_count":   len(req.ToolSchemas),
		"has_system":   req.System != "",
	}

	if p.includePayload {
		data["system"] = req.System
		data["messages"] = req.Messages
		data["tool_schemas"] = req.ToolSchemas
	}

	return data
}

// responseData 提取响应数据用于追踪
func (p *TracingProvider) responseData(resp *LlmResponse, elapsed time.Duration) map[string]any {
	data := map[string]any{
		"stop_reason":  resp.StopReason,
		"tool_calls":   len(resp.ToolCalls),
		"elapsed_ms":   elapsed.Milliseconds(),
		"text_length":  len(resp.Text),
	}

	if resp.Usage != nil {
		data["input_tokens"] = resp.Usage.InputTokens
		data["output_tokens"] = resp.Usage.OutputTokens
		data["context_pct"] = resp.Usage.ContextPct
	}

	if p.includePayload {
		data["text"] = resp.Text
		data["thinking_blocks"] = len(resp.ThinkingBlocks)
	}

	return data
}

// Ensure TracingProvider satisfies Provider interface
var _ Provider = (*TracingProvider)(nil)
