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

// InvokeTool drives the full lifecycle of a single tool call, including retries and event publishing.
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

	// Publish the tool call started event
	busInst.Publish(&bus.ToolCallStartedEvent{
		Type:      "tool.call_started",
		RunID:     runID,
		ToolUseID: toolCallID,
		ToolName:  toolName,
		Params:    params,
		TS:        now,
	})

	// Look up the tool in the registry
	tool, ok := registry.Get(toolName)
	if !ok {
		return fail(busInst, runID, toolCallID, toolName, ErrorTypeRuntime,
			fmt.Sprintf("unknown tool: %s", toolName), 0, 1)
	}

	// Execute with timeout and retry logic
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

		// Return immediately on success
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

		// Non-retryable errors are returned immediately
		if !isRetryable(result.ErrorType) {
			return fail(busInst, runID, toolCallID, toolName,
				result.ErrorType, result.Content,
				int(time.Since(start).Milliseconds()), attempt)
		}

		// Apply exponential backoff before retrying
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

	// All retry attempts exhausted; return the last error
	return fail(busInst, runID, toolCallID, toolName,
		result.ErrorType, result.Content,
		int(time.Since(start).Milliseconds()), maxRetries+1)
}

// fail publishes a tool call failure event and returns an error result.
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

// isRetryable determines whether the given error type warrants a retry attempt.
func isRetryable(errorType string) bool {
	return errorType == ErrorTypeRuntime || errorType == ErrorTypeRateLimited
}
