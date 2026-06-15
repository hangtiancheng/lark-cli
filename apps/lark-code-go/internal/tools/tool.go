package tools

import "context"

// ToolResult represents the return value of a tool invocation.
type ToolResult struct {
	Content   string `json:"content"`
	IsError   bool   `json:"is_error"`
	ErrorType string `json:"error_type,omitempty"`
}

// Tool defines the interface that all tools must implement.
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Invoke(ctx context.Context, params map[string]any) (*ToolResult, error)
}

// ErrorType constants classify tool errors for retry and reporting logic.
const (
	ErrorTypeRuntime     = "runtime_error"
	ErrorTypeTimeout     = "timeout"
	ErrorTypeSchema      = "schema_error"
	ErrorTypePermission  = "permission_denied"
	ErrorTypeRateLimited = "rate_limited"
)
