package conversation

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

type Manager struct {
	history     []Message
	longTermMemoryInjected bool
}
