package tui

import (
	"fmt"
	"strings"
)

// permissionDecision constants for the four permission choices.
const (
	DecisionAllowOnce   = "allow_once"
	DecisionAlwaysAllow = "always_allow"
	DecisionDenyOnce    = "deny_once"
	DecisionAlwaysDeny  = "always_deny"
)

// permissionLabelMap maps a decision to a human-readable label (matches Python _LABEL_MAP).
var permissionLabelMap = map[string]string{
	DecisionAllowOnce:   "allowed (once)",
	DecisionAlwaysAllow: "always allowed",
	DecisionDenyOnce:    "denied",
	DecisionAlwaysDeny:  "always denied",
	"timeout":           "timed out",
}

// permChoice pairs a decision value with a display label and key hints.
type permChoice struct {
	decision string
	label    string
	keyHint  string
}

// permChoices is the ordered list of permission options.
var permChoices = []permChoice{
	{DecisionAllowOnce, "Allow once", "y / 1"},
	{DecisionAlwaysAllow, "Always allow", "a / 2"},
	{DecisionDenyOnce, "Deny", "n / 3"},
	{DecisionAlwaysDeny, "Always deny", "d / 4"},
}

// permKeyMap maps keyboard shortcuts to decisions.
var permKeyMap = map[string]string{
	"y": DecisionAllowOnce,
	"1": DecisionAllowOnce,
	"a": DecisionAlwaysAllow,
	"2": DecisionAlwaysAllow,
	"n": DecisionDenyOnce,
	"3": DecisionDenyOnce,
	"d": DecisionAlwaysDeny,
	"4": DecisionAlwaysDeny,
}

// PermissionBlock is a single-line summary in the log view tracking a pending
// or resolved permission request. Mirrors Python's PermissionBlock.
type PermissionBlock struct {
	toolUseID        string
	toolName         string
	paramPreview     string
	resolved         bool
	resolvedDecision string
}

// NewPermissionBlock creates a pending permission block.
func NewPermissionBlock(toolUseID, toolName, paramPreview string) *PermissionBlock {
	return &PermissionBlock{
		toolUseID:    toolUseID,
		toolName:     toolName,
		paramPreview: paramPreview,
	}
}

// ToolUseID returns the associated tool_use_id.
func (p *PermissionBlock) ToolUseID() string {
	return p.toolUseID
}

// IsResolved reports whether a decision has been recorded.
func (p *PermissionBlock) IsResolved() bool {
	return p.resolved
}

// Resolve records the decision and marks the block resolved.
func (p *PermissionBlock) Resolve(decision string) {
	p.resolved = true
	p.resolvedDecision = decision
}

// Render produces the display string.
func (p *PermissionBlock) Render(width int) string {
	preview := ""
	if p.paramPreview != "" {
		preview = "  " + dimStyle.Render(p.paramPreview)
	}

	if !p.resolved {
		return fmt.Sprintf("%s %s  %s%s",
			warningStyle.Bold(true).Render("?"),
			boldStyle.Render("permission"),
			boldStyle.Render(p.toolName),
			preview)
	}

	// Resolved: show ✓ for allow decisions, ✗ for deny/timeout.
	allowed := p.resolvedDecision == DecisionAllowOnce || p.resolvedDecision == DecisionAlwaysAllow
	icon := successStyle.Bold(true).Render("✓")
	if !allowed {
		icon = errorStyle.Bold(true).Render("✗")
	}
	label := permissionLabelMap[p.resolvedDecision]
	if label == "" {
		label = p.resolvedDecision
	}
	return fmt.Sprintf("%s %s  %s%s  %s",
		icon,
		boldStyle.Render("permission"),
		boldStyle.Render(p.toolName),
		preview,
		dimStyle.Render(label))
}

// PermissionSelect is the inline keyboard-navigable permission chooser.
// Mirrors Python's PermissionSelect.
type PermissionSelect struct {
	toolUseID string
	cursor    int
}

// NewPermissionSelect creates a select widget for the given tool_use_id.
func NewPermissionSelect(toolUseID string) *PermissionSelect {
	return &PermissionSelect{
		toolUseID: toolUseID,
	}
}

// ToolUseID returns the associated tool_use_id.
func (s *PermissionSelect) ToolUseID() string {
	return s.toolUseID
}

// MoveUp moves the cursor up (wrapping).
func (s *PermissionSelect) MoveUp() {
	s.cursor = (s.cursor - 1 + len(permChoices)) % len(permChoices)
}

// MoveDown moves the cursor down (wrapping).
func (s *PermissionSelect) MoveDown() {
	s.cursor = (s.cursor + 1) % len(permChoices)
}

// CurrentDecision returns the decision under the cursor.
func (s *PermissionSelect) CurrentDecision() string {
	return permChoices[s.cursor].decision
}

// LookupKey maps a key string to a decision. Returns ok=false if the key
// is not a permission shortcut.
func (s *PermissionSelect) LookupKey(key string) (string, bool) {
	d, ok := permKeyMap[key]
	return d, ok
}

// Render produces the display string for the select widget.
func (s *PermissionSelect) Render(width int) string {
	var lines []string
	for i, c := range permChoices {
		if i == s.cursor {
			lines = append(lines, fmt.Sprintf("  %s  %s",
				accentStyle.Bold(true).Render("❯ "+c.label),
				dimStyle.Render(c.keyHint)))
		} else {
			lines = append(lines, fmt.Sprintf("    %s  %s",
				c.label, dimStyle.Render(c.keyHint)))
		}
	}
	lines = append(lines, dimStyle.Render("  ↑↓ navigate   enter confirm"))
	return permissionStyle.Render(strings.Join(lines, "\n"))
}
