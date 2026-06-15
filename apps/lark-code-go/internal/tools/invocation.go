package tools

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

const (
	defaultTimeout   = 120 * time.Second
	maxRetries       = 2
	retryBaseSeconds = 1
)

// InvokeTool 驱动单个工具调用的完整生命周期
func InvokeTool(
	ctx context.Context,
	registry *Registry,
	toolCallID string,
	toolName string,
	params map[string]any,
	busInst *events.EventBus,
	runID string,
) *ToolResult {
	now := time.Now().UTC().Format(time.RFC3339)

	// 发布开始事件
	busInst.Publish(&bus.ToolCallStartedEvent{
		Type:      "tool.call_started",
		RunID:     runID,
		ToolUseID: toolCallID,
		ToolName:  toolName,
		Params:    params,
		TS:        now,
	})

	// 查找工具
	tool, ok := registry.Get(toolName)
	if !ok {
		return fail(busInst, runID, toolCallID, toolName, ErrorTypeRuntime,
			fmt.Sprintf("unknown tool: %s", toolName), 0, 1)
	}

	// 带超时的执行 + 重试
	start := time.Now()
	var result *ToolResult
	for attempt := 1; attempt <= maxRetries+1; attempt++ {
		timeoutCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
		var err error
		result, err = tool.Invoke(timeoutCtx, params)
		cancel()

		if err != nil {
			result = &ToolResult{
				Content:   err.Error(),
				IsError:   true,
				ErrorType: ErrorTypeRuntime,
			}
		}

		// 成功则返回
		if !result.IsError {
			elapsed := int(time.Since(start).Milliseconds())
			busInst.Publish(&bus.ToolCallFinishedEvent{
				Type:      "tool.call_finished",
				RunID:     runID,
				ToolUseID: toolCallID,
				ToolName:  toolName,
				ElapsedMS: elapsed,
				Output:    result.Content,
				TS:        time.Now().UTC().Format(time.RFC3339),
			})
			return result
		}

		// 不可重试的错误直接返回
		if !isRetryable(result.ErrorType) {
			return fail(busInst, runID, toolCallID, toolName,
				result.ErrorType, result.Content,
				int(time.Since(start).Milliseconds()), attempt)
		}

		// 重试前等待
		if attempt <= maxRetries {
			backoff := time.Duration(retryBaseSeconds*(1<<(attempt-1))) * time.Second
			slog.Warn("tool invocation retrying",
				"tool", toolName, "attempt", attempt, "backoff", backoff)
			select {
			case <-ctx.Done():
				return fail(busInst, runID, toolCallID, toolName,
					ErrorTypeRuntime, "context cancelled",
					int(time.Since(start).Milliseconds()), attempt)
			case <-time.After(backoff):
			}
		}
	}

	// 所有重试都失败
	return fail(busInst, runID, toolCallID, toolName,
		result.ErrorType, result.Content,
		int(time.Since(start).Milliseconds()), maxRetries+1)
}

// fail 发布失败事件并返回错误结果
func fail(
	busInst *events.EventBus,
	runID, toolCallID, toolName, errorClass, message string,
	elapsedMS, attempt int,
) *ToolResult {
	busInst.Publish(&bus.ToolCallFailedEvent{
		Type:         "tool.call_failed",
		RunID:        runID,
		ToolUseID:    toolCallID,
		ToolName:     toolName,
		ErrorClass:   errorClass,
		ErrorMessage: message,
		ElapsedMS:    elapsedMS,
		Attempt:      attempt,
		TS:           time.Now().UTC().Format(time.RFC3339),
	})
	return &ToolResult{
		Content:   message,
		IsError:   true,
		ErrorType: errorClass,
	}
}

// isRetryable 判断错误类型是否可重试
func isRetryable(errorType string) bool {
	return errorType == ErrorTypeRuntime || errorType == ErrorTypeRateLimited
}
