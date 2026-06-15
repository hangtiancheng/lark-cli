package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// NoteSaveTool 将笔记追加到 session 的 notes.md 文件
type NoteSaveTool struct {
	sessionDir string
	runID      string
}

func NewNoteSaveTool(sessionDir, runID string) *NoteSaveTool {
	return &NoteSaveTool{sessionDir: sessionDir, runID: runID}
}

func (t *NoteSaveTool) Name() string        { return "note_save" }
func (t *NoteSaveTool) Description() string  { return "Save a note to the current session's notes file" }
func (t *NoteSaveTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"content": map[string]any{
				"type":        "string",
				"description": "Note content to append",
			},
		},
		"required": []string{"content"},
	}
}

func (t *NoteSaveTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	content, ok := params["content"].(string)
	if !ok || content == "" {
		return &ToolResult{Content: "content parameter is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}

	if t.sessionDir == "" {
		return &ToolResult{Content: "no session directory", IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	notesPath := filepath.Join(t.sessionDir, "notes.md")

	entry := fmt.Sprintf("\n<!-- run: %s -->\n%s\n", t.runID, content)

	f, err := os.OpenFile(notesPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return &ToolResult{Content: fmt.Sprintf("failed to open notes file: %s", err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}
	defer f.Close()

	if _, err := f.WriteString(entry); err != nil {
		return &ToolResult{Content: fmt.Sprintf("failed to write note: %s", err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	return &ToolResult{Content: "note saved"}, nil
}
