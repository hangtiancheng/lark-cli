package bus

import (
	"encoding/json"
	"fmt"
)

// SessionMode 定义 session 模式
type SessionMode string

const (
	SessionModeOneShot SessionMode = "one_shot"
	SessionModeChat    SessionMode = "chat"
)

// SessionStatus 定义 session 状态
type SessionStatus string

const (
	SessionStatusActive          SessionStatus = "active"
	SessionStatusWaitingForInput SessionStatus = "waiting_for_input"
	SessionStatusClosed          SessionStatus = "closed"
)

// -- Ping --

// PingCommand 请求心跳检测
type PingCommand struct {
	Client string `json:"client"`
}

// PongResult 返回心跳响应
type PongResult struct {
	ServerVersion string `json:"server_version"`
	UptimeMS      int64  `json:"uptime_ms"`
	ReceivedAt    string `json:"received_at"`
}

// -- Agent Run --

// AgentRunCommand 请求一次性 agent 运行
type AgentRunCommand struct {
	Goal string `json:"goal"`
}

// AgentRunResult 返回 agent 运行结果
type AgentRunResult struct {
	RunID string `json:"run_id"`
}

// -- Event Subscribe --

// EventSubscribeCommand 请求订阅事件流
type EventSubscribeCommand struct {
	Topics        []string `json:"topics"`
	Scope         string   `json:"scope"`
	ReplayFromRun string   `json:"replay_from_run,omitempty"`
}

// EventSubscribeResult 返回订阅确认
type EventSubscribeResult struct {
	SubscriptionID string `json:"subscription_id"`
	ReplayedCount  int    `json:"replayed_count"`
}

// -- Session Create --

// SessionCreateCommand 请求创建新 session
type SessionCreateCommand struct {
	Mode  SessionMode `json:"mode"`
	Title string      `json:"title"`
}

// SessionCreateResult 返回创建的 session 信息
type SessionCreateResult struct {
	SessionID string        `json:"session_id"`
	Status    SessionStatus `json:"status"`
}

// -- Session Send Message --

// SessionSendMessageCommand 请求发送消息到 session
type SessionSendMessageCommand struct {
	SessionID string `json:"session_id"`
	Content   string `json:"content"`
}

// SessionSendMessageResult 返回消息发送结果
type SessionSendMessageResult struct {
	RunID string `json:"run_id"`
}

// -- Session Get History --

// SessionGetHistoryCommand 请求获取 session 历史
type SessionGetHistoryCommand struct {
	SessionID string `json:"session_id"`
}

// SessionGetHistoryResult 返回 session 历史消息
type SessionGetHistoryResult struct {
	Messages []json.RawMessage `json:"messages"`
}

// -- Session Close --

// SessionCloseCommand 请求关闭 session
type SessionCloseCommand struct {
	SessionID string `json:"session_id"`
}

// SessionCloseResult 返回关闭后的 session 状态
type SessionCloseResult struct {
	Status SessionStatus `json:"status"`
}

// -- Permission Respond --

// PermissionRespondCommand 响应权限审批请求
type PermissionRespondCommand struct {
	ToolUseID string `json:"tool_use_id"`
	Decision  string `json:"decision"`
}

// PermissionRespondResult 返回权限响应确认
type PermissionRespondResult struct {
	OK bool `json:"ok"`
}

// -- Session Compact --

// SessionCompactCommand 请求压缩 session 上下文
type SessionCompactCommand struct {
	SessionID string `json:"session_id"`
	Focus     string `json:"focus"`
}

// SessionCompactResult 返回压缩结果
type SessionCompactResult struct {
	SummaryTokens int `json:"summary_tokens"`
	SavedTokens   int `json:"saved_tokens"`
}

// -- Command Dispatch --

// commandTypes 注册所有命令类型名到解析函数的映射
var commandTypes = map[string]func() any{
	"core.ping":           func() any { return &PingCommand{} },
	"agent.run":           func() any { return &AgentRunCommand{} },
	"event.subscribe":     func() any { return &EventSubscribeCommand{} },
	"session.create":      func() any { return &SessionCreateCommand{} },
	"session.send_message": func() any { return &SessionSendMessageCommand{} },
	"session.get_history":  func() any { return &SessionGetHistoryCommand{} },
	"session.close":        func() any { return &SessionCloseCommand{} },
	"permission.respond":   func() any { return &PermissionRespondCommand{} },
	"session.compact":      func() any { return &SessionCompactCommand{} },
}

// UnmarshalCommand 从 JSON-RPC 请求的 params 解析命令对象
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
