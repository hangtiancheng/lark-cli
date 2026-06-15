package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	listDirMaxDepth   = 4
	listDirMaxEntries = 200
)

// ListDirTool lists directory contents in a tree-like format with depth control.
type ListDirTool struct {
	cwd string
}

func NewListDirTool(cwd string) *ListDirTool {
	return &ListDirTool{cwd: cwd}
}

func (t *ListDirTool) Name() string        { return "list_dir" }
func (t *ListDirTool) Description() string { return "List directory contents in a tree format" }
func (t *ListDirTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Directory path to list (default: current directory)",
			},
			"max_depth": map[string]any{
				"type":        "integer",
				"description": "Maximum depth to traverse (default: 4)",
			},
		},
		"required": []string{},
	}
}

func (t *ListDirTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	dirPath := "."
	if p, ok := params["path"].(string); ok && p != "" {
		dirPath = p
	}

	maxDepth := listDirMaxDepth
	if d, ok := params["max_depth"].(float64); ok && d > 0 {
		maxDepth = int(d)
	}

	resolved := dirPath
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(t.cwd, resolved)
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return &ToolResult{Content: fmt.Sprintf("cannot access %s: %s", dirPath, err), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}
	if !info.IsDir() {
		return &ToolResult{Content: fmt.Sprintf("%s is not a directory", dirPath), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	var lines []string
	count := 0

	var walk func(path string, depth int, prefix string)
	walk = func(path string, depth int, prefix string) {
		if depth > maxDepth || count >= listDirMaxEntries {
			return
		}

		entries, err := os.ReadDir(path)
		if err != nil {
			return
		}

		// Sort entries: directories first, then alphabetically by name
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].IsDir() != entries[j].IsDir() {
				return entries[i].IsDir()
			}
			return entries[i].Name() < entries[j].Name()
		})

		for i, entry := range entries {
			if count >= listDirMaxEntries {
				lines = append(lines, prefix+"... (truncated)")
				return
			}

			isLast := i == len(entries)-1
			connector := "├── "
			if isLast {
				connector = "└── "
			}

			name := entry.Name()
			if entry.IsDir() {
				name += "/"
			}

			lines = append(lines, prefix+connector+name)
			count++

			if entry.IsDir() {
				childPrefix := prefix + "│   "
				if isLast {
					childPrefix = prefix + "    "
				}
				walk(filepath.Join(path, entry.Name()), depth+1, childPrefix)
			}
		}
	}

	lines = append(lines, resolved+"/")
	walk(resolved, 1, "")

	if count >= listDirMaxEntries {
		lines = append(lines, fmt.Sprintf("\n(truncated at %d entries)", listDirMaxEntries))
	}

	// Filter out noisy directories (e.g., node_modules, .git)
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if !shouldSkipEntry(line) {
			filtered = append(filtered, line)
		}
	}

	return &ToolResult{Content: strings.Join(filtered, "\n")}, nil
}

// shouldSkipEntry determines whether a directory entry should be excluded from output.
func shouldSkipEntry(line string) bool {
	// Extract the file/directory name from the tree-formatted line
	parts := strings.Split(line, " ")
	if len(parts) == 0 {
		return false
	}
	name := parts[len(parts)-1]
	name = strings.TrimSuffix(name, "/")

	// Skip commonly noisy directories that add little value to the output
	skipDirs := map[string]bool{
		"node_modules": true,
		".git":         true,
		"__pycache__":  true,
		".next":        true,
		"dist":         true,
		"build":        true,
	}

	return skipDirs[name]
}

// ensure ListDirTool satisfies Tool
var _ Tool = (*ListDirTool)(nil)
