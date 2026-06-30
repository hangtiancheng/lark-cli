package mcp

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestContext7MCP(t *testing.T) {
	cfg := ServerConfig{
		Name:    "context7",
		Command: "npx",
		Args:    []string{"-y", "@upstash/context7-mcp"},
	}

	client := NewClient(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Log("Connecting to context7 MCP server...")
	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()
	t.Log("Connected successfully")

	t.Log("Listing tools...")
	tools, err := client.ListTools(ctx)
	if err != nil {
		t.Fatalf("ListTools failed: %v", err)
	}
	t.Logf("Got %d tools:", len(tools))
	for _, tool := range tools {
		t.Logf("  - %s: %s", tool.Name, tool.Description)
	}

	if len(tools) == 0 {
		t.Fatal("No tools returned")
	}

	// Print the input schema of the first tool
	t.Logf("Input schema: %+v", tools[0].InputSchema)

	// Call resolve-library-id with "bubbles"
	t.Log("Calling resolve-library-id with 'bubbles'...")
	text, isError, err := client.CallTool(ctx, "resolve-library-id", map[string]any{
		"query":       "charmbracelet/bubbles",
		"libraryName": "bubbles",
	})
	if err != nil {
		t.Fatalf("CallTool failed: %v", err)
	}
	t.Logf("isError: %v", isError)
	t.Logf("Result: %s", truncate(text, 500))

	// Test tool name sanitization and schema
	wrapper := &MCPToolWrapper{
		serverName: "context7",
		toolDef:    tools[0],
		client:     client,
	}
	t.Logf("Sanitized tool name: %s", wrapper.Name())

	schema := wrapper.Schema()
	t.Logf("Schema name: %s", schema["name"])
	t.Logf("Schema has description: %v", schema["description"] != nil && schema["description"] != "")
	inputSchema, ok := schema["input_schema"].(map[string]any)
	if !ok {
		t.Fatalf("input_schema is not map[string]any, got %T", schema["input_schema"])
	}
	t.Logf("input_schema type field: %v", inputSchema["type"])
	t.Logf("input_schema has properties: %v", inputSchema["properties"] != nil)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + fmt.Sprintf("... (%d bytes total)", len(s))
}
