package tools

import "sync"

// Registry 管理已注册的工具
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewRegistry 创建空的工具注册表
func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]Tool),
	}
}

// Register 注册一个工具
func (r *Registry) Register(tool Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[tool.Name()] = tool
}

// Get 按名称查找工具
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tool, ok := r.tools[name]
	return tool, ok
}

// ToolSchemas 生成 Anthropic API 格式的工具 schema 列表
func (r *Registry) ToolSchemas() []map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()

	schemas := make([]map[string]any, 0, len(r.tools))
	for _, tool := range r.tools {
		schemas = append(schemas, map[string]any{
			"name":         tool.Name(),
			"description":  tool.Description(),
			"input_schema": tool.InputSchema(),
		})
	}
	return schemas
}

// Names 返回所有已注册工具的名称
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	return names
}
