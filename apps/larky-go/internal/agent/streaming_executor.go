package agent

import (
	"context"
	"sync"

	"larky/internal/llm"
	"larky/internal/permissions"
	"larky/internal/tools"
)

type StreamingExecutor struct {
	registry *tools.Registry
	checker  *permissions.Checker
	eventCh  chan AgentEvent

	mu      sync.Mutex
	pending []pendingTool
	wg      sync.WaitGroup
}

type pendingTool struct {
	call   llm.ToolCallComplete
	result toolExecResult
	done   bool
}

func NewStreamingExecutor(registry *tools.Registry, checker *permissions.Checker, eventCh chan AgentEvent) *StreamingExecutor {
	return &StreamingExecutor{
		registry: registry,
		checker:  checker,
		eventCh:  eventCh,
	}
}

func (se *StreamingExecutor) Submit(ctx context.Context, agent *Agent, tc llm.ToolCallComplete) {
	se.mu.Lock()
	idx := len(se.pending)
	se.pending = append(se.pending, pendingTool{call: tc})
	se.mu.Unlock()

	se.wg.Add(1)
	go func() {
		defer se.wg.Done()
		result := agent.executeSingleTool(ctx, se.eventCh, tc)

		se.mu.Lock()
		se.pending[idx].result = result
		se.pending[idx].done = true
		se.mu.Unlock()
	}()
}

func (se *StreamingExecutor) CollectResults() []toolExecResult {
	se.wg.Wait()

	se.mu.Lock()
	defer se.mu.Unlock()

	results := make([]toolExecResult, len(se.pending))
	for i, p := range se.pending {
		results[i] = p.result
	}
	return results
}

func (se *StreamingExecutor) HasPending() bool {
	se.mu.Lock()
	defer se.mu.Unlock()
	return len(se.pending) > 0
}

func (se *StreamingExecutor) Reset() {
	se.mu.Lock()
	defer se.mu.Unlock()
	se.pending = nil
}
