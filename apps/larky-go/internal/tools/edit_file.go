package tools

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/filehistory"
)

type EditFileTool struct {
	FileHistory    *filehistory.History
	FileStateCache *FileStateCache
}

func (t *EditFileTool) Name() string { return "EditFile" }

func (t *EditFileTool) Description() string { return EditFileDescription }

func (t *EditFileTool) Category() ToolCategory { return CategoryWrite }

func (t *EditFileTool) Schema() map[string]any {
	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"file_path":  map[string]any{"type": "string", "description": "Path to the file to edit"},
				"old_string": map[string]any{"type": "string", "description": "The exact string to find and replace (must be unique in file)"},
				"new_string": map[string]any{"type": "string", "description": "The replacement string"},
			},
			"required": []string{"file_path", "old_string", "new_string"},
		},
	}
}

func (t *EditFileTool) Execute(_ context.Context, args map[string]any) ToolResult {
	filePath, _ := args["file_path"].(string)
	oldStr, _ := args["old_string"].(string)
	newStr, _ := args["new_string"].(string)

	if filePath == "" {
		return ToolResult{Output: "Error: file_path is required", IsError: true}
	}

	// Read-before-edit gate
	if t.FileStateCache != nil {
		if ok, errMsg := t.FileStateCache.Check(filePath); !ok {
			return ToolResult{Output: errMsg, IsError: true}
		}
	}

	if t.FileHistory != nil {
		t.FileHistory.TrackEdit(filePath)
	}

	data, err := os.ReadFile(filePath)
	if os.IsNotExist(err) {
		return ToolResult{Output: fmt.Sprintf("Error: file not found: %s", filePath), IsError: true}
	}
	if err != nil {
		return ToolResult{Output: fmt.Sprintf("Error reading file: %s", err), IsError: true}
	}

	content := string(data)
	count := strings.Count(content, oldStr)
	if count == 0 {
		return ToolResult{Output: "Error: old_string not found in file", IsError: true}
	}
	if count > 1 {
		return ToolResult{Output: fmt.Sprintf("Error: old_string found %d times, must be unique", count), IsError: true}
	}

	newContent := strings.Replace(content, oldStr, newStr, 1)
	if err := os.WriteFile(filePath, []byte(newContent), 0o644); err != nil {
		return ToolResult{Output: fmt.Sprintf("Error writing file: %s", err), IsError: true}
	}

	// Update cache after successful edit
	if t.FileStateCache != nil {
		t.FileStateCache.Update(filePath, newContent)
	}

	return ToolResult{Output: fmt.Sprintf("Successfully edited %s", filePath)}
}
