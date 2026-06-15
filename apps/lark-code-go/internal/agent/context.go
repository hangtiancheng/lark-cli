package agent

import (
	"os"
	"path/filepath"
	"strings"
)

// ExecutionContext 维护一次 agent run 的消息状态和系统提示
type ExecutionContext struct {
	sessionID    string
	messages     []map[string]any
	newMessages  []map[string]any
	systemPrompt string
	status       RunStatus
	reason       string
	steps        int
}

// RunStatus 表示 run 的状态
type RunStatus string

const (
	StatusRunning  RunStatus = "running"
	StatusSuccess  RunStatus = "success"
	StatusFailed   RunStatus = "failed"
	StatusCanceled RunStatus = "canceled"
)

// NewExecutionContext 创建执行上下文
func NewExecutionContext(sessionID string, existingMessages []map[string]any, systemPrompt string) *ExecutionContext {
	msgs := make([]map[string]any, len(existingMessages))
	copy(msgs, existingMessages)
	return &ExecutionContext{
		sessionID:    sessionID,
		messages:     msgs,
		systemPrompt: systemPrompt,
		status:       StatusRunning,
	}
}

// Messages 返回当前完整消息列表（只读副本）
func (ec *ExecutionContext) Messages() []map[string]any {
	result := make([]map[string]any, len(ec.messages))
	copy(result, ec.messages)
	return result
}

// NewMessages 返回本次 run 新增的消息
func (ec *ExecutionContext) NewMessages() []map[string]any {
	result := make([]map[string]any, len(ec.newMessages))
	copy(result, ec.newMessages)
	return result
}

// SystemPrompt 返回系统提示
func (ec *ExecutionContext) SystemPrompt() string {
	return ec.systemPrompt
}

// Status 返回当前状态
func (ec *ExecutionContext) Status() RunStatus {
	return ec.status
}

// Reason 返回状态原因
func (ec *ExecutionContext) Reason() string {
	return ec.reason
}

// Steps 返回已执行步数
func (ec *ExecutionContext) Steps() int {
	return ec.steps
}

// SetStatus 设置状态和原因
func (ec *ExecutionContext) SetStatus(status RunStatus, reason string) {
	ec.status = status
	ec.reason = reason
}

// IncrementStep 增加步数计数
func (ec *ExecutionContext) IncrementStep() {
	ec.steps++
}

// AddUserMessage 添加用户消息
func (ec *ExecutionContext) AddUserMessage(content string) {
	msg := map[string]any{
		"role":    "user",
		"content": content,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// AddAssistantMessage 添加 assistant 回复消息（含 thinking/text/tool_use blocks）
func (ec *ExecutionContext) AddAssistantMessage(contentBlocks []map[string]any) {
	msg := map[string]any{
		"role":    "assistant",
		"content": contentBlocks,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// AddToolResults 添加工具调用结果消息
func (ec *ExecutionContext) AddToolResults(results []map[string]any) {
	msg := map[string]any{
		"role":    "user",
		"content": results,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// ReplaceMessages 替换整个消息列表（用于压缩后）
func (ec *ExecutionContext) ReplaceMessages(messages []map[string]any) {
	ec.messages = make([]map[string]any, len(messages))
	copy(ec.messages, messages)
}

// BuildSystemPrompt 组装完整的系统提示，包括全局/项目上下文和 session notes
func BuildSystemPrompt(globalCtx, projectCtx, sessionNotes, override string) string {
	if override != "" {
		return override
	}

	var parts []string
	parts = append(parts, "You are a helpful AI coding assistant. Use the available tools to help the user accomplish tasks.")

	if globalCtx != "" {
		parts = append(parts, "\n## Global Context\n"+globalCtx)
	}
	if projectCtx != "" {
		parts = append(parts, "\n## Project Context\n"+projectCtx)
	}
	if sessionNotes != "" {
		parts = append(parts, "\n## Session Notes\n"+sessionNotes)
	}

	return strings.Join(parts, "\n")
}

// LoadContextFile 加载上下文文件，不存在时返回空字符串
func LoadContextFile(path string) string {
	resolved := path
	if strings.HasPrefix(resolved, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			resolved = filepath.Join(home, resolved[2:])
		}
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
