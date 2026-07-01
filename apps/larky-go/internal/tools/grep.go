package tools

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type GrepTool struct{}

func (t *GrepTool) Name() string { return "Grep" }

func (t *GrepTool) Description() string { return GrepDescription }

func (t *GrepTool) Category() ToolCategory { return CategoryRead }

func (t *GrepTool) Schema() map[string]any {
	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"pattern": map[string]any{"type": "string", "description": "Regex pattern to search for"},
				"path":    map[string]any{"type": "string", "description": "Base directory to search from", "default": "."},
				"include": map[string]any{"type": "string", "description": "Glob filter for filenames (e.g. '*.py')"},
			},
			"required": []string{"pattern"},
		},
	}
}

func (t *GrepTool) Execute(_ context.Context, args map[string]any) ToolResult {
	pattern, _ := args["pattern"].(string)
	basePath, _ := args["path"].(string)
	include, _ := args["include"].(string)
	if basePath == "" {
		basePath = "."
	}
	if pattern == "" {
		return ToolResult{Output: "Error: pattern is required", IsError: true}
	}

	info, err := os.Stat(basePath)
	if os.IsNotExist(err) {
		return ToolResult{Output: fmt.Sprintf("Error: path not found: %s", basePath), IsError: true}
	}
	if err != nil || !info.IsDir() {
		return ToolResult{Output: fmt.Sprintf("Error: path not found: %s", basePath), IsError: true}
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		return ToolResult{Output: fmt.Sprintf("Error: invalid regex: %s", err), IsError: true}
	}

	var files []string
	filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if SkipDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if include != "" {
			matched, _ := filepath.Match(include, info.Name())
			if !matched {
				return nil
			}
		}
		files = append(files, path)
		return nil
	})
	sort.Strings(files)

	var results []string
	for _, fpath := range files {
		f, err := os.Open(fpath)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		lineNum := 0
		for scanner.Scan() {
			lineNum++
			line := scanner.Text()
			if re.MatchString(line) {
				rel, _ := filepath.Rel(basePath, fpath)
				results = append(results, fmt.Sprintf("%s:%d:%s", rel, lineNum, line))
			}
		}
		if err := scanner.Err(); err != nil {
			results = append(results, fmt.Sprintf("Error reading %s: %s", fpath, err))
		}
		f.Close()
	}

	if len(results) == 0 {
		return ToolResult{Output: "No matches found."}
	}
	return ToolResult{Output: strings.Join(results, "\n")}
}
