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

// LoopConfig 控制 AgentLoop 的运行参数
type LoopConfig struct {
	MaxSteps          int
	CompactThreshold  float64 // context_pct 达到此比例时自动压缩 (0.0-1.0)
	ToolResultLimit   int     // tool_result 字符数限制
	ToolResultKeep    int     // 截断后保留的字符数
}

// DefaultLoopConfig 返回默认的循环配置
func DefaultLoopConfig() *LoopConfig {
	return &LoopConfig{
		MaxSteps:         20,
		CompactThreshold: 0.8,
		ToolResultLimit:  50000,
		ToolResultKeep:   5000,
	}
}

// ToolInvoker 是工具调用的抽象接口，允许注入不同的实现
type ToolInvoker interface {
	Invoke(ctx context.Context, registry *tools.Registry, toolCallID, toolName string, params map[string]any) *tools.ToolResult
}

// DefaultToolInvoker 使用 tools.InvokeTool 的默认实现
type DefaultToolInvoker struct {
	Bus   *events.EventBus
	RunID string
}

func (d *DefaultToolInvoker) Invoke(ctx context.Context, registry *tools.Registry, toolCallID, toolName string, params map[string]any) *tools.ToolResult {
	return tools.InvokeTool(ctx, registry, toolCallID, toolName, params, d.Bus, d.RunID)
}

// AgentLoop 驱动 plan-act-observe 循环
type AgentLoop struct {
	cfg       *LoopConfig
	provider  llm.Provider
	registry  *tools.Registry
	bus       *events.EventBus
	compactor *compact.Compactor
	invoker   ToolInvoker
}

// RunOutcome 是 AgentLoop.Run() 的返回值
type RunOutcome struct {
	Status RunStatus
	Reason string
	Steps  int
	Text   string // 最后一次 assistant 文本输出
}

// NewAgentLoop 创建 agent 循环
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

// SetInvoker 设置工具调用器（用于测试或自定义）
func (al *AgentLoop) SetInvoker(invoker ToolInvoker) {
	al.invoker = invoker
}

// Run 执行 agent 循环，直到 end_turn、max_steps 或 context cancellation
func (al *AgentLoop) Run(ctx context.Context, ec *ExecutionContext, runID string) (*RunOutcome, error) {
	if al.invoker == nil {
		al.invoker = &DefaultToolInvoker{Bus: al.bus, RunID: runID}
	}

	// 发布 run.started
	al.bus.Publish(&bus.RunStartedEvent{
		Type:  "run.started",
		RunID: runID,
		Goal:  extractGoal(ec),
		TS:    time.Now().UTC().Format(time.RFC3339),
	})

	var lastText string

	for step := 1; step <= al.cfg.MaxSteps; step++ {
		ec.IncrementStep()

		// 检查取消
		select {
		case <-ctx.Done():
			ec.SetStatus(StatusCanceled, "cancelled")
			return al.finish(ec, runID, lastText, ctx.Err()), nil
		default:
		}

		// 发布 step.started
		al.bus.Publish(&bus.StepStartedEvent{
			Type:  "step.started",
			RunID: runID,
			Step:  step,
			TS:    time.Now().UTC().Format(time.RFC3339),
		})

		// 构建 LLM 请求
		chatReq := &llm.ChatRequest{
			Messages:    ec.Messages(),
			ToolSchemas: al.registry.ToolSchemas(),
			System:      ec.SystemPrompt(),
			Step:        step,
			RunID:       runID,
			Bus:         al.bus,
		}

		// 调用 LLM
		resp, err := al.provider.Chat(ctx, chatReq)
		if err != nil {
			ec.SetStatus(StatusFailed, "llm_error")
			slog.Error("LLM call failed", "error", err, "step", step, "run_id", runID)
			return al.finish(ec, runID, lastText, err), err
		}

		// 构建 assistant 内容块
		contentBlocks := buildContentBlocks(resp)
		ec.AddAssistantMessage(contentBlocks)
		lastText = resp.Text

		// 处理 stop_reason
		switch resp.StopReason {
		case "end_turn":
			ec.SetStatus(StatusSuccess, "end_turn")
			al.publishStepFinished(runID, step)
			return al.finish(ec, runID, lastText, nil), nil

		case "max_tokens":
			// max_tokens 容错：如果有未完成的 tool_calls，注入合成错误
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

			// 执行工具调用
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

			// 自动压缩检查
			if resp.Usage != nil && al.shouldCompact(resp.Usage.ContextPct) {
				al.tryAutoCompact(ctx, ec, runID)
			}

		default:
			// 未知 stop_reason，尝试继续
			slog.Warn("unknown stop_reason", "reason", resp.StopReason, "step", step)
			al.publishStepFinished(runID, step)
			if len(resp.ToolCalls) == 0 {
				ec.SetStatus(StatusSuccess, resp.StopReason)
				return al.finish(ec, runID, lastText, nil), nil
			}
		}
	}

	// 超过最大步数
	ec.SetStatus(StatusFailed, "exceeded_max_steps")
	return al.finish(ec, runID, lastText, fmt.Errorf("exceeded max steps: %d", al.cfg.MaxSteps)), nil
}

// shouldCompact 判断是否需要自动压缩
func (al *AgentLoop) shouldCompact(contextPct float64) bool {
	if al.compactor == nil || al.cfg.CompactThreshold <= 0 {
		return false
	}
	return contextPct >= al.cfg.CompactThreshold
}

// tryAutoCompact 尝试自动压缩对话上下文
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

// buildContentBlocks 从 LLM 响应构建 assistant 内容块
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

// extractGoal 从上下文中提取目标（最后一条用户消息）
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

// publishStepFinished 发布 step.finished 事件
func (al *AgentLoop) publishStepFinished(runID string, step int) {
	al.bus.Publish(&bus.StepFinishedEvent{
		Type:  "step.finished",
		RunID: runID,
		Step:  step,
		TS:    time.Now().UTC().Format(time.RFC3339),
	})
}

// finish 发布 run.finished 并返回 outcome
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
