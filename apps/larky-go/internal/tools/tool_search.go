package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type ToolSearchTool struct {
	Registry *Registry
	Protocol string
}

func (t *ToolSearchTool) Name() string { return "ToolSearch" }

func (t *ToolSearchTool) Description() string {
	return `Search for and load additional tools that are not immediately available. Some tools are deferred (not loaded by default) to save context space. Use this tool to discover and load them.

Query forms:
- "select:ToolName,AnotherTool" — fetch exact tools by name
- "keyword search" — keyword search, returns up to max_results matches

When you need a tool that isn't in your current tool list, use this to find it.`
}

func (t *ToolSearchTool) Category() ToolCategory { return CategoryRead }

func (t *ToolSearchTool) Schema() map[string]any {
	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": `Query to find deferred tools. Use "select:Name1,Name2" for direct selection, or keywords to search.`,
				},
				"max_results": map[string]any{
					"type":        "integer",
					"description": "Maximum results to return (default: 5)",
					"default":     5,
				},
			},
			"required": []string{"query"},
		},
	}
}

func (t *ToolSearchTool) Execute(ctx context.Context, args map[string]any) ToolResult {
	query, _ := args["query"].(string)
	if query == "" {
		return ToolResult{Output: "Error: query is required", IsError: true}
	}

	maxResults := intArg(args, "max_results", 5)
	if maxResults < 1 {
		maxResults = 5
	}
	if maxResults > 20 {
		maxResults = 20
	}

	var schemas []map[string]any

	if strings.HasPrefix(query, "select:") {
		names := strings.Split(strings.TrimPrefix(query, "select:"), ",")
		for i := range names {
			names[i] = strings.TrimSpace(names[i])
		}
		schemas = t.Registry.FindDeferredByNames(names, t.Protocol)
	} else {
		schemas = t.Registry.SearchDeferred(query, maxResults, t.Protocol)
	}

	if len(schemas) == 0 {
		deferredNames := t.Registry.GetDeferredToolNames()
		if len(deferredNames) == 0 {
			return ToolResult{
				Output: fmt.Sprintf("No deferred tools available for query %q.", query),
			}
		}
		return ToolResult{
			Output: fmt.Sprintf("No matching deferred tools found for query %q. Available deferred tools: %s",
				query, strings.Join(deferredNames, ", ")),
		}
	}

	// Mark discovered tools so their schemas are included in subsequent API requests
	for _, s := range schemas {
		if name, ok := s["name"].(string); ok {
			t.Registry.MarkDiscovered(name)
		}
	}

	schemasJSON, _ := json.MarshalIndent(schemas, "", "  ")
	return ToolResult{
		Output: fmt.Sprintf("Found %d tool(s). Their full schemas are now loaded and will be available in subsequent requests:\n\n%s", len(schemas), string(schemasJSON)),
	}
}
