package tools

import "context"

// ToolResult 表示工具调用的返回结果
type ToolResult struct {
	Content   string `json:"content"`
	IsError   bool   `json:"is_error"`
	ErrorType string `json:"error_type,omitempty"`
}

// Tool 是工具的接口
type Tool interface {
	Name() string
	Description() string
	InputSchema() map[string]any
	Invoke(ctx context.Context, params map[string]any) (*ToolResult, error)
}

// ErrorType 常量
const (
	ErrorTypeRuntime     = "runtime_error"
	ErrorTypeTimeout     = "timeout"
	ErrorTypeSchema      = "schema_error"
	ErrorTypePermission  = "permission_denied"
	ErrorTypeRateLimited = "rate_limited"
)
