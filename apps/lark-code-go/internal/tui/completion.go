package tui

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/skills"
)

// CompletionItem pairs a skill/command name with a short description.
type CompletionItem struct {
	Name        string
	Description string
}

// CompletionPopup is the slash-command autocomplete popup. It filters a list
// of available skills (loaded from the skills.Loader) plus the built-in
// /compact command. Mirrors Python's SlashCompleteWidget.
type CompletionPopup struct {
	allItems []CompletionItem
	filtered []CompletionItem
	cursor   int
	hasQuery bool
}

// NewCompletionPopup builds the popup from the skills loader and the built-in
// /compact command. projectDir is passed to the loader to include project-level
// skills.
func NewCompletionPopup(projectDir string) *CompletionPopup {
	p := &CompletionPopup{}

	// Built-in commands first.
	p.allItems = append(p.allItems, CompletionItem{
		Name:        "compact",
		Description: "compress context window",
	})

	// Load all skills (project > user > builtin).
	loader := skills.NewLoader()
	for _, s := range loader.ListAllWithDir(projectDir) {
		desc := s.Description
		if idx := strings.IndexByte(desc, '\n'); idx >= 0 {
			desc = desc[:idx]
		}
		if len(desc) > 60 {
			desc = desc[:57] + "..."
		}
		p.allItems = append(p.allItems, CompletionItem{
			Name:        s.Name,
			Description: desc,
		})
	}

	// Deduplicate by name, keeping the first occurrence (compact/builtins first).
	seen := make(map[string]bool)
	unique := p.allItems[:0]
	for _, item := range p.allItems {
		if seen[item.Name] {
			continue
		}
		seen[item.Name] = true
		unique = append(unique, item)
	}
	p.allItems = unique

	// Sort alphabetically, but keep "compact" first.
	sort.SliceStable(p.allItems, func(i, j int) bool {
		if p.allItems[i].Name == "compact" {
			return true
		}
		if p.allItems[j].Name == "compact" {
			return false
		}
		return p.allItems[i].Name < p.allItems[j].Name
	})

	p.filtered = p.allItems
	return p
}

// SetQuery filters the item list by the query string (case-insensitive,
// matched against the name). An empty query shows all items.
func (p *CompletionPopup) SetQuery(query string) {
	p.hasQuery = query != ""
	q := strings.ToLower(query)
	p.filtered = p.filtered[:0]
	for _, item := range p.allItems {
		if q == "" || strings.Contains(strings.ToLower(item.Name), q) {
			p.filtered = append(p.filtered, item)
		}
	}
	if p.cursor >= len(p.filtered) {
		p.cursor = max(0, len(p.filtered)-1)
	}
}

// MoveUp moves the cursor up (wrapping).
func (p *CompletionPopup) MoveUp() {
	if len(p.filtered) == 0 {
		return
	}
	p.cursor = (p.cursor - 1 + len(p.filtered)) % len(p.filtered)
}

// MoveDown moves the cursor down (wrapping).
func (p *CompletionPopup) MoveDown() {
	if len(p.filtered) == 0 {
		return
	}
	p.cursor = (p.cursor + 1) % len(p.filtered)
}

// HasSelection reports whether there is at least one matchable item.
func (p *CompletionPopup) HasSelection() bool {
	return len(p.filtered) > 0
}

// SelectedName returns the name under the cursor, or "" if empty.
func (p *CompletionPopup) SelectedName() string {
	if len(p.filtered) == 0 {
		return ""
	}
	return p.filtered[p.cursor].Name
}

// Render produces the display string for the popup.
func (p *CompletionPopup) Render(width int) string {
	if len(p.filtered) == 0 {
		return completionStyle.Render(dimStyle.Render("  no matching commands"))
	}
	var lines []string
	for i, item := range p.filtered {
		descPart := ""
		if item.Description != "" {
			descPart = "  " + dimStyle.Render(item.Description)
		}
		if i == p.cursor {
			lines = append(lines, fmt.Sprintf("  %s%s",
				accentStyle.Bold(true).Render("❯ /"+item.Name),
				descPart))
		} else {
			lines = append(lines, fmt.Sprintf("    %s%s",
				accentStyle.Render("/"+item.Name),
				descPart))
		}
	}
	lines = append(lines, dimStyle.Render("  ↑↓ navigate   tab/enter select   esc dismiss"))
	return completionStyle.Render(strings.Join(lines, "\n"))
}

// LineCount returns the number of lines the popup will occupy (including the
// hint line), used by the view layout to reserve space.
func (p *CompletionPopup) LineCount() int {
	if len(p.filtered) == 0 {
		return 2 // "no matching" + hint
	}
	return len(p.filtered) + 1
}

// currentProjectDir returns the working directory, used as the project root
// for skill discovery.
func currentProjectDir() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	return dir
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
