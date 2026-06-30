package agent

import "time"

type AgentEvent interface{ agentEvent() }

type StreamText struct{ Text string }
type ThinkingText struct{ Text string }
type ToolUseEvent struct {
	ToolID   string
	ToolName string
	Args     map[string]any
}
type ToolResultEvent struct {
	ToolID   string
	ToolName string
	Output   string
	IsError  bool
	Elapsed  time.Duration
}
type TurnComplete struct{ Turn int }
type LoopComplete struct{ TotalTurns int }
type UsageEvent struct{ InputTokens, OutputTokens int }
type ErrorEvent struct{ Message string }
type CompactEvent struct{ Message string }
type RetryEvent struct {
	Reason string
	Wait   time.Duration
}

type PermissionResponse int

const (
	PermAllow PermissionResponse = iota
	PermDeny
	PermAllowAlways
)

type PermissionRequestEvent struct {
	ToolName   string
	Desc       string
	ResponseCh chan<- PermissionResponse
}

func (StreamText) agentEvent() {}

func (ThinkingText) agentEvent() {}

func (ToolUseEvent) agentEvent()    {}
func (ToolResultEvent) agentEvent() {}

func (TurnComplete) agentEvent() {}

func (LoopComplete) agentEvent() {}
func (UsageEvent) agentEvent()   {}
func (ErrorEvent) agentEvent()   {}
func (CompactEvent) agentEvent() {}

func (RetryEvent) agentEvent()             {}
func (PermissionRequestEvent) agentEvent() {}

type AskUserQuestionEvent struct {
	Questions  []map[string]any
	ResponseCh chan map[string]string
}

func (AskUserQuestionEvent) agentEvent() {}
