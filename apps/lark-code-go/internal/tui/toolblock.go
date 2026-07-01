package tui

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ToolBlock is a collapsible tool-call entry in the log view. While the tool
// is running it shows a pending summary; once finished it shows the elapsed
// time and status. The block can be expanded to reveal full params and output.
// Mirrors Python's ToolCallBlock.
type ToolBlock struct {
	toolName  string
	params    map[string]any
	paramsRaw string
	output    string
	elapsedMs int
	isError   bool
	finished  bool
	expanded  bool
	indent    string // optional indentation prefix (for subagent nesting)
}

// NewToolBlock creates a tool-call block for the given tool and params.
func NewToolBlock(toolName string, params map[string]any) *ToolBlock {
	return &ToolBlock{
		toolName:  toolName,
		params:    params,
		paramsRaw: paramsString(params),
	}
}

// SetIndent sets a leading indentation prefix (used for subagent nesting).
func (t *ToolBlock) SetIndent(indent string) {
	t.indent = indent
}

// SetResult records the tool execution outcome and marks the block finished.
func (t *ToolBlock) SetResult(output string, elapsedMs int, isError bool) {
	t.output = output
	t.elapsedMs = elapsedMs
	t.isError = isError
	t.finished = true
}

// Toggle flips the expanded/collapsed state. Only finished blocks with output
// can be expanded.
func (t *ToolBlock) Toggle() {
	if !t.finished || t.output == "" {
		return
	}
	t.expanded = !t.expanded
}

// IsExpanded reports whether the block is currently expanded.
func (t *ToolBlock) IsExpanded() bool {
	return t.expanded
}

// IsFinished reports whether the tool call has completed.
func (t *ToolBlock) IsFinished() bool {
	return t.finished
}

// Render produces the display string for this block.
func (t *ToolBlock) Render(width int) string {
	var b strings.Builder
	b.WriteString(t.indent)
	b.WriteString(t.summary())

	if t.expanded {
		b.WriteString("\n")
		b.WriteString(t.detail())
	}
	return b.String()
}

// summary returns the one-line summary.
func (t *ToolBlock) summary() string {
	// Special-case note_save: show "remembered" once finished.
	if t.toolName == "note_save" && t.finished && !t.isError {
		return fmt.Sprintf("  %s  %s",
			successStyle.Render("remembered"),
			dimStyle.Render(fmt.Sprintf("%dms", t.elapsedMs)))
	}

	paramsPre := paramSummary(t.toolName, t.params)
	var line string
	line = fmt.Sprintf("  %s %s", dimStyle.Render("tool"), toolStyle.Render(t.toolName))
	if paramsPre != "" {
		line += "  " + dimStyle.Render(paramsPre)
	}

	if t.finished {
		var statusPart string
		if t.isError {
			statusPart = errorStyle.Render("failed")
		} else {
			statusPart = successStyle.Render("done")
		}
		hint := ""
		if t.output != "" {
			hint = "  " + dimStyle.Render("(tab to expand)")
		}
		line += "  " + statusPart + "  " + dimStyle.Render(fmt.Sprintf("%dms", t.elapsedMs)) + hint
	}
	return line
}

// detail returns the expanded params/output section.
func (t *ToolBlock) detail() string {
	var b strings.Builder
	b.WriteString(t.indent)
	b.WriteString("  ")
	b.WriteString(dimStyle.Render("params"))
	b.WriteString("\n")
	b.WriteString(t.indent)
	b.WriteString("  ")
	b.WriteString(indentText(t.paramsRaw, t.indent+"  "))
	b.WriteString("\n\n")
	b.WriteString(t.indent)
	b.WriteString("  ")
	b.WriteString(dimStyle.Render("output"))
	b.WriteString("\n")
	b.WriteString(t.indent)
	b.WriteString("  ")
	b.WriteString(indentText(truncateOutput(t.output, 4000), t.indent+"  "))
	b.WriteString("\n\n")
	b.WriteString(t.indent)
	b.WriteString("  ")
	b.WriteString(dimStyle.Render(fmt.Sprintf("elapsed: %dms", t.elapsedMs)))
	return b.String()
}

// paramsString pretty-prints the tool parameters as indented JSON.
func paramsString(params map[string]any) string {
	if params == nil {
		return "{}"
	}
	data, err := json.MarshalIndent(params, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", params)
	}
	return string(data)
}

// paramSummary extracts the most relevant parameter(s) for a compact summary,
// mirroring Python's _param_summary.
func paramSummary(toolName string, params map[string]any, maxLen ...int) string {
	limit := 72
	if len(maxLen) > 0 {
		limit = maxLen[0]
	}

	keysByTool := map[string][]string{
		"read_file":  {"path"},
		"write_file": {"path"},
		"list_dir":   {"path", "max_depth"},
		"bash":       {"command"},
		"note_save":  {"content"},
	}

	keys, ok := keysByTool[toolName]
	if !ok {
		// Fallback: take the first two params.
		i := 0
		for k, v := range params {
			keys = append(keys, k)
			_ = v
			i++
			if i >= 2 {
				break
			}
		}
	}

	var parts []string
	for _, k := range keys {
		if v, ok := params[k]; ok {
			parts = append(parts, fmt.Sprintf("%s=%#v", k, v))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return truncate(strings.Join(parts, ", "), limit)
}

// indentText prefixes every line of s with the given indent (except the first
// line, which is assumed to already have its prefix applied by the caller).
func indentText(s, indent string) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	for i := 1; i < len(lines); i++ {
		lines[i] = indent + lines[i]
	}
	return strings.Join(lines, "\n")
}

// truncate shortens s to maxLen characters, appending an ellipsis if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// truncateOutput caps long tool output for display.
func truncateOutput(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "\n... (truncated)"
}
