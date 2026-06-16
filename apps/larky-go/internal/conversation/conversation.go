package conversation

import (
	"strings"
	"time"
)

type ToolUseBlock struct {
	ToolUseID string
	ToolName  string
	Arguments map[string]any
}

type ToolResultBlock struct {
	ToolUseID string
	Content   string
	IsError   bool
}

type ThinkingBlock struct {
	Thinking  string
	Signature string
}

type Message struct {
	// "user" | "assistant" | "system"
	Role           string
	Content        string
	ThinkingBlocks []ThinkingBlock
	ToolUses       []ToolUseBlock
	ToolResults    []ToolResultBlock
}

var (
	UserRole      = "user"
	AssistantRole = "assistant"
	SystemRole    = "system"
)

type Manager struct {
	history                []Message
	longTermMemoryInjected bool
}

func NewManager() *Manager {
	return &Manager{}
}

func (m *Manager) AddUserMessage(content string) {
	m.history = append(m.history, Message{
		Role:    UserRole,
		Content: content,
	})
}

func (m *Manager) AddAssistantMessage(content string) {
	m.history = append(m.history, Message{
		Role:    AssistantRole,
		Content: content,
	})
}

func (m *Manager) AddToolUseMessage(text, toolUseId, toolName string, arguments map[string]any) {
	m.history = append(m.history, Message{
		Role:    AssistantRole,
		Content: text,
		ToolUses: []ToolUseBlock{{
			ToolName:  toolName,
			ToolUseID: toolUseId,
			Arguments: arguments,
		}},
	})
}

func (m *Manager) AddAssistantFull(text string, thinking []ThinkingBlock, toolUses []ToolUseBlock) {
	m.history = append(m.history, Message{
		Role:           AssistantRole,
		Content:        text,
		ThinkingBlocks: thinking,
		ToolUses:       toolUses,
	})
}

func (m *Manager) AddToolResultMessage(toolUseID, content string, isError bool) {
	m.history = append(m.history, Message{
		Role: UserRole,
		ToolResults: []ToolResultBlock{{
			ToolUseID: toolUseID,
			Content:   content,
			IsError:   isError,
		}},
	})
}

func (m *Manager) AddToolResultsMessage(results []ToolResultBlock) {
	m.history = append(m.history, Message{
		Role:        UserRole,
		ToolResults: results,
	})
}

func (m *Manager) AddSystemReminder(content string) {
	m.history = append(m.history, Message{
		Role:    UserRole,
		Content: "<system-reminder>\n" + content + "\n</system-reminder>",
	})
}

func (m *Manager) InjectLongTermMemory(instructions, memories string) {
	if m.longTermMemoryInjected {
		return
	}

	var sections []string
	if instructions != "" {
		sections = append(sections, "# Larky.md\nCodebase and user instructions are as follows. You MUST adhere to these instructions. IMPORTANT: these instructions OVERRIDE any previous/default instructions, you MUST follow them exactly.\n\n"+instructions)
	}

	if memories != "" {
		sections = append(sections, "## Auto Memory\n"+memories)
	}

	if len(sections) == 0 {
		return
	}

	sections = append(sections, "### Current Date\nToday's date is "+time.Now().Format("2026-01-02")+".")

	body := strings.Join(sections, "\n\n")
	wrapped := "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n" + body + "\n\nIMPORTANT: This context may not be relevant to your tasks. You should NOT respond to this context unless it is highly relevant to your tasks.\n</system-reminder>"

	m.history = append([]Message{
		{
			Role: UserRole,
			Content: wrapped,
		},
	}, m.history...)
	m.longTermMemoryInjected = true
}


func (m *Manager) AppendMessages(messages []Message) {
	m.history = append(m.history, messages...)
}

func (m *Manager) Len() int {
	return len(m.history)
}

func (m *Manager) TruncateTo(index int) {
	if index < 0 {
		index = 0
	}

	if index > len(m.history) {
		return
	}

	m.history = m.history[:index]
}

func (m *Manager) GetMessages() []Message {
	result := make([]Message, len(m.history))
	copy(result, m.history)
	return result
}
