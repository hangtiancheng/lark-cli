package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"larky/internal/file_history"
)

type WriteFileTool struct {
	FileHistory    *file_history.History
	FileStateCache *FileStateCache
}

func (t *WriteFileTool) Name() string { return "WriteFile" }

func (t *WriteFileTool) Description() string { return WriteFileDescription }

func (t *WriteFileTool) Category() ToolCategory { return CategoryWrite }

func (t *WriteFileTool) Schema() map[string]any {
	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"file_path": map[string]any{"type": "string", "description": "Path to the file to write"},
				"content":   map[string]any{"type": "string", "description": "Content to write to the file"},
			},
			"required": []string{"file_path", "content"},
		},
	}
}

func (t *WriteFileTool) Execute(_ context.Context, args map[string]any) ToolResult {
	filePath, _ := args["file_path"].(string)
	content, _ := args["content"].(string)
	if filePath == "" {
		return ToolResult{Output: "Error: file_path is required", IsError: true}
	}

	// Read-before-edit gate — skip for new files
	if t.FileStateCache != nil {
		if _, err := os.Stat(filePath); err == nil {
			// File exists: must have been read first
			if ok, errMsg := t.FileStateCache.Check(filePath); !ok {
				return ToolResult{Output: errMsg, IsError: true}
			}
		}
	}

	if t.FileHistory != nil {
		t.FileHistory.TrackEdit(filePath)
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return ToolResult{Output: fmt.Sprintf("Error creating directories: %s", err), IsError: true}
	}

	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		return ToolResult{Output: fmt.Sprintf("Error writing file: %s", err), IsError: true}
	}

	// Update cache after successful write
	if t.FileStateCache != nil {
		t.FileStateCache.Update(filePath, content)
	}

	return ToolResult{Output: fmt.Sprintf("Successfully wrote to %s", filePath)}
}
