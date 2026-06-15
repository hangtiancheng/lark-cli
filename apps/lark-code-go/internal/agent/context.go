package agent

import (
	"os"
	"path/filepath"
	"strings"
)

// ExecutionContext maintains message state and the system prompt for a single agent run.
type ExecutionContext struct {
	sessionID    string
	messages     []map[string]any
	newMessages  []map[string]any
	systemPrompt string
	status       RunStatus
	reason       string
	steps        int
}

// RunStatus represents the lifecycle state of an agent run.
type RunStatus string

const (
	StatusRunning  RunStatus = "running"
	StatusSuccess  RunStatus = "success"
	StatusFailed   RunStatus = "failed"
	StatusCanceled RunStatus = "canceled"
)

// NewExecutionContext creates a new execution context with existing messages and system prompt.
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

// Messages returns a read-only copy of the current full message list.
func (ec *ExecutionContext) Messages() []map[string]any {
	result := make([]map[string]any, len(ec.messages))
	copy(result, ec.messages)
	return result
}

// NewMessages returns only the messages added during the current run.
func (ec *ExecutionContext) NewMessages() []map[string]any {
	result := make([]map[string]any, len(ec.newMessages))
	copy(result, ec.newMessages)
	return result
}

// SystemPrompt returns the assembled system prompt.
func (ec *ExecutionContext) SystemPrompt() string {
	return ec.systemPrompt
}

// Status returns the current run status.
func (ec *ExecutionContext) Status() RunStatus {
	return ec.status
}

// Reason returns the reason associated with the current status.
func (ec *ExecutionContext) Reason() string {
	return ec.reason
}

// Steps returns the number of steps executed so far.
func (ec *ExecutionContext) Steps() int {
	return ec.steps
}

// SetStatus updates the run status and its associated reason.
func (ec *ExecutionContext) SetStatus(status RunStatus, reason string) {
	ec.status = status
	ec.reason = reason
}

// IncrementStep increments the step counter by one.
func (ec *ExecutionContext) IncrementStep() {
	ec.steps++
}

// AddUserMessage appends a user message to the conversation.
func (ec *ExecutionContext) AddUserMessage(content string) {
	msg := map[string]any{
		"role":    "user",
		"content": content,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// AddAssistantMessage appends an assistant response message containing thinking, text, and/or tool_use blocks.
func (ec *ExecutionContext) AddAssistantMessage(contentBlocks []map[string]any) {
	msg := map[string]any{
		"role":    "assistant",
		"content": contentBlocks,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// AddToolResults appends tool call result messages to the conversation.
func (ec *ExecutionContext) AddToolResults(results []map[string]any) {
	msg := map[string]any{
		"role":    "user",
		"content": results,
	}
	ec.messages = append(ec.messages, msg)
	ec.newMessages = append(ec.newMessages, msg)
}

// ReplaceMessages replaces the entire message list (used after context compaction).
func (ec *ExecutionContext) ReplaceMessages(messages []map[string]any) {
	ec.messages = make([]map[string]any, len(messages))
	copy(ec.messages, messages)
}

// BuildSystemPrompt assembles the full system prompt from global context, project context, session notes, and optional override.
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

// LoadContextFile reads a context file from disk, returning an empty string if the file does not exist.
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
