package agent

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/compact"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// LoopConfig controls the runtime parameters of the AgentLoop.
type LoopConfig struct {
	MaxSteps         int
	CompactThreshold float64 // Automatically compact when context_pct reaches this threshold (0.0-1.0)
	ToolResultLimit  int     // Maximum character limit for tool_result content
	ToolResultKeep   int     // Number of characters to retain after truncation
}

// DefaultLoopConfig returns the default loop configuration.
func DefaultLoopConfig() *LoopConfig {
	return &LoopConfig{
		MaxSteps:         20,
		CompactThreshold: 0.8,
		ToolResultLimit:  50000,
		ToolResultKeep:   5000,
	}
}

// ToolInvoker is an abstraction for tool invocation, allowing pluggable implementations.
type ToolInvoker interface {
	Invoke(ctx context.Context, registry *tools.Registry, toolCallID, toolName string, params map[string]any) *tools.ToolResult
}

// DefaultToolInvoker is the default implementation that delegates to tools.InvokeTool.
type DefaultToolInvoker struct {
	Bus   *events.EventBus
	RunID string
}

func (d *DefaultToolInvoker) Invoke(ctx context.Context, registry *tools.Registry, toolCallID, toolName string, params map[string]any) *tools.ToolResult {
	return tools.InvokeTool(ctx, registry, toolCallID, toolName, params, d.Bus, d.RunID)
}

// AgentLoop drives the plan-act-observe (ReAct) loop.
type AgentLoop struct {
	cfg       *LoopConfig
	provider  llm.Provider
	registry  *tools.Registry
	bus       *events.EventBus
	compactor *compact.Compactor
	invoker   ToolInvoker
}

// RunOutcome is the return value of AgentLoop.Run().
type RunOutcome struct {
	Status RunStatus
	Reason string
	Steps  int
	Text   string // The last assistant text output
}

// NewAgentLoop creates a new agent loop.
func NewAgentLoop(
	cfg *LoopConfig,
	provider llm.Provider,
	registry *tools.Registry,
	busInst *events.EventBus,
	compactor *compact.Compactor,
) *AgentLoop {
	return &AgentLoop{
		cfg:       cfg,
		provider:  provider,
		registry:  registry,
		bus:       busInst,
		compactor: compactor,
	}
}

// SetInvoker sets the tool invoker (for testing or custom implementations).
func (al *AgentLoop) SetInvoker(invoker ToolInvoker) {
	al.invoker = invoker
}

// Run executes the agent loop until end_turn, max_steps is reached, or the context is cancelled.
func (al *AgentLoop) Run(ctx context.Context, ec *ExecutionContext, runID string) (*RunOutcome, error) {
	if al.invoker == nil {
		al.invoker = &DefaultToolInvoker{Bus: al.bus, RunID: runID}
	}

	// Publish the run.started event
	al.bus.Publish(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: runID,
		Goal:  extractGoal(ec),
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	var lastText string

	for step := 1; step <= al.cfg.MaxSteps; step++ {
		ec.IncrementStep()

		// Check for context cancellation
		select {
		case <-ctx.Done():
			ec.SetStatus(StatusCanceled, "cancelled")
			return al.finish(ec, runID, lastText, ctx.Err()), nil
		default:
		}

		// Publish the step.started event
		al.bus.Publish(&bus.StepStartedEvent{
			Type:  "step.started",
			RunID: runID,
			Step:  step,
			TS:    time.Now().UTC().Format(time.RFC3339),
		})

		// Build the LLM chat request
		chatReq := &llm.ChatRequest{
			Messages:    ec.Messages(),
			ToolSchemas: al.registry.ToolSchemas(),
			System:      ec.SystemPrompt(),
			Step:        step,
			RunID:       runID,
			Bus:         al.bus,
		}

		// Invoke the LLM
		resp, err := al.provider.Chat(ctx, chatReq)
		if err != nil {
			ec.SetStatus(StatusFailed, "llm_error")
			slog.Error("LLM call failed", "error", err, "step", step, "run_id", runID)
			return al.finish(ec, runID, lastText, err), err
		}

		// Build assistant content blocks from the response
		contentBlocks := buildContentBlocks(resp)
		ec.AddAssistantMessage(contentBlocks)
		lastText = resp.Text

		// Handle the stop_reason from the LLM response
		switch resp.StopReason {
		case "end_turn":
			ec.SetStatus(StatusSuccess, "end_turn")
			al.publishStepFinished(runID, step)
			return al.finish(ec, runID, lastText, nil), nil

		case "max_tokens":
			// max_tokens tolerance: inject synthetic errors for pending tool calls
			if len(resp.ToolCalls) > 0 {
				slog.Warn("max_tokens reached with pending tool calls, injecting synthetic errors",
					"step", step, "run_id", runID, "tool_calls", len(resp.ToolCalls))
				syntheticResults := make([]map[string]any, 0, len(resp.ToolCalls))
				for _, tc := range resp.ToolCalls {
					syntheticResults = append(syntheticResults, map[string]any{
						"type":        "tool_result",
						"tool_use_id": tc.ID,
						"content":     "Error: response truncated due to max_tokens limit",
						"is_error":    true,
					})
				}
				ec.AddToolResults(syntheticResults)
				al.publishStepFinished(runID, step)
				continue
			}
			ec.SetStatus(StatusFailed, "max_tokens")
			return al.finish(ec, runID, lastText, fmt.Errorf("max_tokens reached")), nil

		case "tool_use":
			if len(resp.ToolCalls) == 0 {
				ec.SetStatus(StatusSuccess, "end_turn")
				al.publishStepFinished(runID, step)
				return al.finish(ec, runID, lastText, nil), nil
			}

			// Execute tool calls
			toolResults := make([]map[string]any, 0, len(resp.ToolCalls))
			for _, tc := range resp.ToolCalls {
				result := al.invoker.Invoke(ctx, al.registry, tc.ID, tc.Name, tc.Input)
				toolResults = append(toolResults, map[string]any{
					"type":        "tool_result",
					"tool_use_id": tc.ID,
					"content":     result.Content,
					"is_error":    result.IsError,
				})
			}
			ec.AddToolResults(toolResults)

			al.publishStepFinished(runID, step)

			// Check if auto-compaction is needed
			if resp.Usage != nil && al.shouldCompact(resp.Usage.ContextPct) {
				al.tryAutoCompact(ctx, ec, runID)
			}

		default:
			// Unknown stop_reason; attempt to continue
			slog.Warn("unknown stop_reason", "reason", resp.StopReason, "step", step)
			al.publishStepFinished(runID, step)
			if len(resp.ToolCalls) == 0 {
				ec.SetStatus(StatusSuccess, resp.StopReason)
				return al.finish(ec, runID, lastText, nil), nil
			}
		}
	}

	// Maximum step count exceeded
	ec.SetStatus(StatusFailed, "exceeded_max_steps")
	return al.finish(ec, runID, lastText, fmt.Errorf("exceeded max steps: %d", al.cfg.MaxSteps)), nil
}

// shouldCompact determines whether auto-compaction should be triggered.
func (al *AgentLoop) shouldCompact(contextPct float64) bool {
	if al.compactor == nil || al.cfg.CompactThreshold <= 0 {
		return false
	}
	return contextPct >= al.cfg.CompactThreshold
}

// tryAutoCompact attempts to automatically compact the conversation context.
func (al *AgentLoop) tryAutoCompact(ctx context.Context, ec *ExecutionContext, runID string) {
	if al.compactor == nil {
		return
	}

	compacted, _, _, err := al.compactor.Compact(ctx, ec.Messages(), "", runID, "")
	if err != nil {
		slog.Warn("auto-compaction failed, continuing with original context", "error", err)
		return
	}

	ec.ReplaceMessages(compacted)
	slog.Info("auto-compaction applied", "run_id", runID)
}

// buildContentBlocks constructs assistant content blocks from the LLM response.
func buildContentBlocks(resp *llm.LlmResponse) []map[string]any {
	var blocks []map[string]any

	// thinking blocks
	for _, tb := range resp.ThinkingBlocks {
		blocks = append(blocks, map[string]any{
			"type":      "thinking",
			"thinking":  tb.Thinking,
			"signature": tb.Signature,
		})
	}

	// text block
	if resp.Text != "" {
		blocks = append(blocks, map[string]any{
			"type": "text",
			"text": resp.Text,
		})
	}

	// tool_use blocks
	for _, tc := range resp.ToolCalls {
		blocks = append(blocks, map[string]any{
			"type":  "tool_use",
			"id":    tc.ID,
			"name":  tc.Name,
			"input": tc.Input,
		})
	}

	return blocks
}

// extractGoal extracts the goal from the context (the last user message).
func extractGoal(ec *ExecutionContext) string {
	msgs := ec.Messages()
	for i := len(msgs) - 1; i >= 0; i-- {
		if role, _ := msgs[i]["role"].(string); role == "user" {
			if content, ok := msgs[i]["content"].(string); ok {
				return content
			}
		}
	}
	return ""
}

// publishStepFinished publishes the step.finished event.
func (al *AgentLoop) publishStepFinished(runID string, step int) {
	al.bus.Publish(&bus.StepFinishedEvent{
		Type:  "step.finished",
		RunID: runID,
		Step:  step,
		TS:    time.Now().UTC().Format(time.RFC3339),
	})
}

// finish publishes run.finished and returns the outcome.
func (al *AgentLoop) finish(ec *ExecutionContext, runID, lastText string, err error) *RunOutcome {
	reason := ec.Reason()
	status := string(ec.Status())

	al.bus.Publish(&bus.RunFinishedEvent{
		Type:   "run.finished",
		RunID:  runID,
		Status: status,
		Reason: reason,
		Steps:  ec.Steps(),
		TS:     time.Now().UTC().Format(time.RFC3339),
	})

	return &RunOutcome{
		Status: ec.Status(),
		Reason: reason,
		Steps:  ec.Steps(),
		Text:   lastText,
	}
}
