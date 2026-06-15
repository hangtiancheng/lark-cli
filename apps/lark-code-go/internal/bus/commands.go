package bus

import (
	"encoding/json"
	"fmt"
)

// SessionMode defines the operating mode for a session.
type SessionMode string

const (
	SessionModeOneShot SessionMode = "one_shot"
	SessionModeChat    SessionMode = "chat"
)

// SessionStatus defines the lifecycle status of a session.
type SessionStatus string

const (
	SessionStatusActive          SessionStatus = "active"
	SessionStatusWaitingForInput SessionStatus = "waiting_for_input"
	SessionStatusClosed          SessionStatus = "closed"
)

// -- Ping --

// PingCommand requests a heartbeat check from the daemon.
type PingCommand struct {
	Client string `json:"client"`
}

// PongResult contains the heartbeat response from the daemon.
type PongResult struct {
	ServerVersion string `json:"server_version"`
	UptimeMS      int64  `json:"uptime_ms"`
	ReceivedAt    string `json:"received_at"`
}

// -- Agent Run --

// AgentRunCommand requests a one-shot agent run with the given goal.
type AgentRunCommand struct {
	Goal string `json:"goal"`
}

// AgentRunResult contains the result of an agent run request.
type AgentRunResult struct {
	RunID string `json:"run_id"`
}

// -- Event Subscribe --

// EventSubscribeCommand requests subscription to the event stream.
type EventSubscribeCommand struct {
	Topics        []string `json:"topics"`
	Scope         string   `json:"scope"`
	ReplayFromRun string   `json:"replay_from_run,omitempty"`
}

// EventSubscribeResult contains the confirmation of an event subscription.
type EventSubscribeResult struct {
	SubscriptionID string `json:"subscription_id"`
	ReplayedCount  int    `json:"replayed_count"`
}

// -- Session Create --

// SessionCreateCommand requests creation of a new session.
type SessionCreateCommand struct {
	Mode  SessionMode `json:"mode"`
	Title string      `json:"title"`
}

// SessionCreateResult contains the newly created session information.
type SessionCreateResult struct {
	SessionID string        `json:"session_id"`
	Status    SessionStatus `json:"status"`
}

// -- Session Send Message --

// SessionSendMessageCommand requests sending a message to an existing session.
type SessionSendMessageCommand struct {
	SessionID string `json:"session_id"`
	Content   string `json:"content"`
}

// SessionSendMessageResult contains the result of sending a message to a session.
type SessionSendMessageResult struct {
	RunID string `json:"run_id"`
}

// -- Session Get History --

// SessionGetHistoryCommand requests the message history of a session.
type SessionGetHistoryCommand struct {
	SessionID string `json:"session_id"`
}

// SessionGetHistoryResult contains the historical messages of a session.
type SessionGetHistoryResult struct {
	Messages []json.RawMessage `json:"messages"`
}

// -- Session Close --

// SessionCloseCommand requests closing an existing session.
type SessionCloseCommand struct {
	SessionID string `json:"session_id"`
}

// SessionCloseResult contains the status of the closed session.
type SessionCloseResult struct {
	Status SessionStatus `json:"status"`
}

// -- Permission Respond --

// PermissionRespondCommand responds to a pending permission approval request.
type PermissionRespondCommand struct {
	ToolUseID string `json:"tool_use_id"`
	Decision  string `json:"decision"`
}

// PermissionRespondResult contains the confirmation of a permission response.
type PermissionRespondResult struct {
	OK bool `json:"ok"`
}

// -- Session Compact --

// SessionCompactCommand requests compaction of a session's conversation context.
type SessionCompactCommand struct {
	SessionID string `json:"session_id"`
	Focus     string `json:"focus"`
}

// SessionCompactResult contains the result of a context compaction operation.
type SessionCompactResult struct {
	SummaryTokens int `json:"summary_tokens"`
	SavedTokens   int `json:"saved_tokens"`
}

// -- Command Dispatch --

// commandTypes maps command method names to their constructor functions for dispatch.
var commandTypes = map[string]func() any{
	"core.ping":            func() any { return &PingCommand{} },
	"agent.run":            func() any { return &AgentRunCommand{} },
	"event.subscribe":      func() any { return &EventSubscribeCommand{} },
	"session.create":       func() any { return &SessionCreateCommand{} },
	"session.send_message": func() any { return &SessionSendMessageCommand{} },
	"session.get_history":  func() any { return &SessionGetHistoryCommand{} },
	"session.close":        func() any { return &SessionCloseCommand{} },
	"permission.respond":   func() any { return &PermissionRespondCommand{} },
	"session.compact":      func() any { return &SessionCompactCommand{} },
}

// UnmarshalCommand parses a command object from JSON-RPC request params based on the method name.
func UnmarshalCommand(method string, params json.RawMessage) (any, error) {
	constructor, ok := commandTypes[method]
	if !ok {
		return nil, fmt.Errorf("unknown command method: %q", method)
	}

	cmd := constructor()
	if params != nil {
		if err := json.Unmarshal(params, cmd); err != nil {
			return nil, fmt.Errorf("failed to unmarshal command %q: %w", method, err)
		}
	}
	return cmd, nil
}
