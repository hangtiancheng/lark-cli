package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	readFileMaxSize = 512 * 1024 // 512KB
)

// ReadFileTool reads the contents of a file within the working directory.
type ReadFileTool struct {
	cwd string
}

func NewReadFileTool(cwd string) *ReadFileTool {
	return &ReadFileTool{cwd: cwd}
}

func (t *ReadFileTool) Name() string        { return "read_file" }
func (t *ReadFileTool) Description() string { return "Read the contents of a file" }
func (t *ReadFileTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Path to the file to read",
			},
		},
		"required": []string{"path"},
	}
}

func (t *ReadFileTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	path, ok := params["path"].(string)
	if !ok || path == "" {
		return &ToolResult{Content: "path parameter is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}

	// Resolve the path relative to the working directory
	resolved := t.resolvePath(path)

	// Security check: prevent path traversal attacks
	if !isPathSafe(t.cwd, resolved) {
		return &ToolResult{
			Content:   "path traversal detected",
			IsError:   true,
			ErrorType: ErrorTypeRuntime,
		}, nil
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		return &ToolResult{Content: fmt.Sprintf("failed to read file: %s", err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	if len(data) > readFileMaxSize {
		content := string(data[:readFileMaxSize])
		content += fmt.Sprintf("\n\n... (file truncated at %d bytes, total %d bytes)", readFileMaxSize, len(data))
		return &ToolResult{Content: content}, nil
	}

	return &ToolResult{Content: string(data)}, nil
}

func (t *ReadFileTool) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(t.cwd, path)
}

// WriteFileTool writes content to a file, creating parent directories as needed.
type WriteFileTool struct {
	cwd string
}

const writeFileMaxSize = 1024 * 1024 // 1MB

func NewWriteFileTool(cwd string) *WriteFileTool {
	return &WriteFileTool{cwd: cwd}
}

func (t *WriteFileTool) Name() string { return "write_file" }
func (t *WriteFileTool) Description() string {
	return "Write content to a file, creating directories as needed"
}
func (t *WriteFileTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Path to the file to write",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "Content to write to the file",
			},
		},
		"required": []string{"path", "content"},
	}
}

func (t *WriteFileTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	path, ok := params["path"].(string)
	if !ok || path == "" {
		return &ToolResult{Content: "path parameter is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}
	content, ok := params["content"].(string)
	if !ok {
		return &ToolResult{Content: "content parameter is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}

	resolved := t.resolvePath(path)

	if !isPathSafe(t.cwd, resolved) {
		return &ToolResult{Content: "path traversal detected", IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	if len(content) > writeFileMaxSize {
		return &ToolResult{
			Content:   fmt.Sprintf("content exceeds maximum size of %d bytes", writeFileMaxSize),
			IsError:   true,
			ErrorType: ErrorTypeRuntime,
		}, nil
	}

	// Automatically create parent directories if they do not exist
	dir := filepath.Dir(resolved)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return &ToolResult{Content: fmt.Sprintf("failed to create directory: %s", err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	if err := os.WriteFile(resolved, []byte(content), 0o644); err != nil {
		return &ToolResult{Content: fmt.Sprintf("failed to write file: %s", err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	return &ToolResult{Content: fmt.Sprintf("wrote %d bytes to %s", len(content), path)}, nil
}

func (t *WriteFileTool) resolvePath(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(t.cwd, path)
}

// isPathSafe verifies that the target path is within the working directory to prevent path traversal.
func isPathSafe(cwd, target string) bool {
	rel, err := filepath.Rel(cwd, target)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}
