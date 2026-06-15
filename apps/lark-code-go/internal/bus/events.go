package bus

import (
	"encoding/json"
	"fmt"
)

// Event is the interface that all event types must implement.
type Event interface {
	EventType() string
}

// -- Lifecycle Events --

// CoreStartedEvent is published when the daemon starts.
type CoreStartedEvent struct {
	Type       string `json:"type"`
	ListenAddr string `json:"listen_addr"`
	Version    string `json:"version"`
}

func (e *CoreStartedEvent) EventType() string { return "core.started" }

// RunStartedEvent is published when an agent run begins.
type RunStartedEvent struct {
	Type  string `json:"type"`
	RunID string `json:"run_id"`
	Goal  string `json:"goal"`
	TS    string `json:"ts"`
}

func (e *RunStartedEvent) EventType() string { return "run.started" }

// RunFinishedEvent is published when an agent run ends.
type RunFinishedEvent struct {
	Type   string `json:"type"`
	RunID  string `json:"run_id"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
	Steps  int    `json:"steps"`
	TS     string `json:"ts"`
}

func (e *RunFinishedEvent) EventType() string { return "run.finished" }

// -- Step Events --

// StepStartedEvent is published at the beginning of each ReAct loop step.
type StepStartedEvent struct {
	Type  string `json:"type"`
	RunID string `json:"run_id"`
	Step  int    `json:"step"`
	TS    string `json:"ts"`
}

func (e *StepStartedEvent) EventType() string { return "step.started" }

// StepFinishedEvent is published at the end of each ReAct loop step.
type StepFinishedEvent struct {
	Type  string `json:"type"`
	RunID string `json:"run_id"`
	Step  int    `json:"step"`
	TS    string `json:"ts"`
}

func (e *StepFinishedEvent) EventType() string { return "step.finished" }

// -- Tool Events --

// ToolCallStartedEvent is published when a tool invocation begins.
type ToolCallStartedEvent struct {
	Type      string         `json:"type"`
	RunID     string         `json:"run_id"`
	ToolUseID string         `json:"tool_use_id"`
	ToolName  string         `json:"tool_name"`
	Params    map[string]any `json:"params"`
	TS        string         `json:"ts"`
}

func (e *ToolCallStartedEvent) EventType() string { return "tool.call_started" }

// ToolCallFinishedEvent is published when a tool invocation completes successfully.
type ToolCallFinishedEvent struct {
	Type      string `json:"type"`
	RunID     string `json:"run_id"`
	ToolUseID string `json:"tool_use_id"`
	ToolName  string `json:"tool_name"`
	ElapsedMS int    `json:"elapsed_ms"`
	Output    string `json:"output,omitempty"`
	TS        string `json:"ts"`
}

func (e *ToolCallFinishedEvent) EventType() string { return "tool.call_finished" }

// ToolCallFailedEvent is published when a tool invocation fails.
type ToolCallFailedEvent struct {
	Type         string `json:"type"`
	RunID        string `json:"run_id"`
	ToolUseID    string `json:"tool_use_id"`
	ToolName     string `json:"tool_name"`
	ErrorClass   string `json:"error_class"`
	ErrorMessage string `json:"error_message"`
	ElapsedMS    int    `json:"elapsed_ms"`
	Attempt      int    `json:"attempt"`
	TS           string `json:"ts"`
}

func (e *ToolCallFailedEvent) EventType() string { return "tool.call_failed" }

// -- LLM Events --

// LlmTokenEvent is published for each token streamed from the LLM.
type LlmTokenEvent struct {
	Type  string `json:"type"`
	RunID string `json:"run_id"`
	Token string `json:"token"`
	TS    string `json:"ts"`
}

func (e *LlmTokenEvent) EventType() string { return "llm.token" }

// LlmUsageEvent is published when an LLM call completes, reporting token usage statistics.
type LlmUsageEvent struct {
	Type                     string  `json:"type"`
	RunID                    string  `json:"run_id"`
	InputTokens              int     `json:"input_tokens"`
	OutputTokens             int     `json:"output_tokens"`
	CacheReadInputTokens     int     `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int     `json:"cache_creation_input_tokens"`
	ContextPct               float64 `json:"context_pct"`
	TS                       string  `json:"ts"`
}

func (e *LlmUsageEvent) EventType() string { return "llm.usage" }

// LlmModelSelectedEvent is published when an LLM model has been selected for use.
type LlmModelSelectedEvent struct {
	Type     string `json:"type"`
	RunID    string `json:"run_id"`
	Model    string `json:"model"`
	Strategy string `json:"strategy"`
	TS       string `json:"ts"`
}

func (e *LlmModelSelectedEvent) EventType() string { return "llm.model_selected" }

// -- Log Event --

// LogLineEvent is published for each system log line.
type LogLineEvent struct {
	Type    string `json:"type"`
	RunID   string `json:"run_id"`
	Level   string `json:"level"`
	Source  string `json:"source"`
	Message string `json:"message"`
	TS      string `json:"ts"`
}

func (e *LogLineEvent) EventType() string { return "log.line" }

// -- Session Events --

// SessionCreatedEvent is published when a new session is created.
type SessionCreatedEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Mode      string `json:"mode"`
	TS        string `json:"ts"`
}

func (e *SessionCreatedEvent) EventType() string { return "session.created" }

// SessionMessageReceivedEvent is published when a user message is received.
type SessionMessageReceivedEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Content   string `json:"content"`
	TS        string `json:"ts"`
}

func (e *SessionMessageReceivedEvent) EventType() string { return "session.message_received" }

// SessionWaitingForInputEvent is published when a session is waiting for user input.
type SessionWaitingForInputEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	LastRunID string `json:"last_run_id"`
	TS        string `json:"ts"`
}

func (e *SessionWaitingForInputEvent) EventType() string { return "session.waiting_for_input" }

// SessionResumedEvent is published when a session resumes from a waiting state.
type SessionResumedEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	TS        string `json:"ts"`
}

func (e *SessionResumedEvent) EventType() string { return "session.resumed" }

// SessionClosedEvent is published when a session is closed.
type SessionClosedEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	TS        string `json:"ts"`
}

func (e *SessionClosedEvent) EventType() string { return "session.closed" }

// -- Context Compaction Event --

// ContextCompactedEvent is published when context compaction has been completed.
type ContextCompactedEvent struct {
	Type           string `json:"type"`
	SessionID      string `json:"session_id"`
	RunID          string `json:"run_id"`
	OriginalTokens int    `json:"original_tokens"`
	SummaryTokens  int    `json:"summary_tokens"`
	TS             string `json:"ts"`
}

func (e *ContextCompactedEvent) EventType() string { return "context.compacted" }

// -- Permission Events --

// PermissionRequestedEvent is published when user approval is required for a tool invocation.
type PermissionRequestedEvent struct {
	Type         string         `json:"type"`
	RunID        string         `json:"run_id"`
	ToolUseID    string         `json:"tool_use_id"`
	ToolName     string         `json:"tool_name"`
	Params       map[string]any `json:"params"`
	ParamPreview string         `json:"param_preview"`
	SessionID    string         `json:"session_id"`
	TS           string         `json:"ts"`
}

func (e *PermissionRequestedEvent) EventType() string { return "permission.requested" }

// PermissionGrantedEvent is published when a permission request is approved.
type PermissionGrantedEvent struct {
	Type      string `json:"type"`
	RunID     string `json:"run_id"`
	ToolUseID string `json:"tool_use_id"`
	Decision  string `json:"decision"`
	TS        string `json:"ts"`
}

func (e *PermissionGrantedEvent) EventType() string { return "permission.granted" }

// PermissionDeniedEvent is published when a permission request is denied.
type PermissionDeniedEvent struct {
	Type      string `json:"type"`
	RunID     string `json:"run_id"`
	ToolUseID string `json:"tool_use_id"`
	Decision  string `json:"decision"`
	TS        string `json:"ts"`
}

func (e *PermissionDeniedEvent) EventType() string { return "permission.denied" }

// -- Subagent Events --

// SubagentStartedEvent is published when a subagent is launched.
type SubagentStartedEvent struct {
	Type        string `json:"type"`
	RunID       string `json:"run_id"`
	ParentRunID string `json:"parent_run_id"`
	Description string `json:"description"`
	TS          string `json:"ts"`
}

func (e *SubagentStartedEvent) EventType() string { return "subagent.started" }

// SubagentFinishedEvent is published when a subagent completes.
type SubagentFinishedEvent struct {
	Type        string `json:"type"`
	RunID       string `json:"run_id"`
	ParentRunID string `json:"parent_run_id"`
	Status      string `json:"status"`
	TS          string `json:"ts"`
}

func (e *SubagentFinishedEvent) EventType() string { return "subagent.finished" }

// -- Skill Event --

// SkillInvokedEvent is published when a skill is invoked.
type SkillInvokedEvent struct {
	Type      string `json:"type"`
	SkillName string `json:"skill_name"`
	Arguments string `json:"arguments"`
	RunID     string `json:"run_id"`
	TS        string `json:"ts"`
}

func (e *SkillInvokedEvent) EventType() string { return "skill.invoked" }

// -- Discriminated Union Serialization --

// eventTypes maps event type names to their constructor functions for discriminated union deserialization.
var eventTypes = map[string]func() Event{
	"core.started":              func() Event { return &CoreStartedEvent{} },
	"run.started":               func() Event { return &RunStartedEvent{} },
	"run.finished":              func() Event { return &RunFinishedEvent{} },
	"step.started":              func() Event { return &StepStartedEvent{} },
	"step.finished":             func() Event { return &StepFinishedEvent{} },
	"tool.call_started":         func() Event { return &ToolCallStartedEvent{} },
	"tool.call_finished":        func() Event { return &ToolCallFinishedEvent{} },
	"tool.call_failed":          func() Event { return &ToolCallFailedEvent{} },
	"llm.token":                 func() Event { return &LlmTokenEvent{} },
	"llm.usage":                 func() Event { return &LlmUsageEvent{} },
	"llm.model_selected":        func() Event { return &LlmModelSelectedEvent{} },
	"log.line":                  func() Event { return &LogLineEvent{} },
	"session.created":           func() Event { return &SessionCreatedEvent{} },
	"session.message_received":  func() Event { return &SessionMessageReceivedEvent{} },
	"session.waiting_for_input": func() Event { return &SessionWaitingForInputEvent{} },
	"session.resumed":           func() Event { return &SessionResumedEvent{} },
	"session.closed":            func() Event { return &SessionClosedEvent{} },
	"context.compacted":         func() Event { return &ContextCompactedEvent{} },
	"permission.requested":      func() Event { return &PermissionRequestedEvent{} },
	"permission.granted":        func() Event { return &PermissionGrantedEvent{} },
	"permission.denied":         func() Event { return &PermissionDeniedEvent{} },
	"subagent.started":          func() Event { return &SubagentStartedEvent{} },
	"subagent.finished":         func() Event { return &SubagentFinishedEvent{} },
	"skill.invoked":             func() Event { return &SkillInvokedEvent{} },
}

// MarshalEvent serializes an event to JSON.
func MarshalEvent(evt Event) ([]byte, error) {
	return json.Marshal(evt)
}

// UnmarshalEvent deserializes an event from JSON using the "type" field as a discriminated union key.
func UnmarshalEvent(data []byte) (Event, error) {
	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return nil, fmt.Errorf("failed to probe event type: %w", err)
	}

	constructor, ok := eventTypes[probe.Type]
	if !ok {
		return nil, fmt.Errorf("unknown event type: %q", probe.Type)
	}

	evt := constructor()
	if err := json.Unmarshal(data, evt); err != nil {
		return nil, fmt.Errorf("failed to unmarshal event %q: %w", probe.Type, err)
	}
	return evt, nil
}
