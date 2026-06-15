package tools

import "sync"

// Registry manages registered tools and provides lookup and schema generation.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewRegistry creates an empty tool registry.
func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]Tool),
	}
}

// Register adds a tool to the registry, keyed by its name.
func (r *Registry) Register(tool Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[tool.Name()] = tool
}

// Get looks up a tool by its registered name.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	tool, ok := r.tools[name]
	return tool, ok
}

// ToolSchemas generates tool schema definitions in the Anthropic API format.
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

// Names returns the names of all registered tools.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	return names
}
