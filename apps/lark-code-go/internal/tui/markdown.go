package tui

import (
	"strings"
	"sync"

	"github.com/charmbracelet/glamour"
)

// markdownRenderer lazily renders Markdown to ANSI-styled text using glamour.
// A single renderer is cached per width to avoid repeated initialization.
type markdownRenderer struct {
	mu       sync.Mutex
	renderer *glamour.TermRenderer
	width    int
}

var mdRenderer markdownRenderer

// renderMarkdown converts a Markdown string into ANSI-styled terminal output.
// The output width adapts to the provided width argument. If rendering fails,
// the original text is returned unchanged (stripped of trailing whitespace).
func renderMarkdown(text string, width int) string {
	if strings.TrimSpace(text) == "" {
		return ""
	}

	r := getRenderer(width)
	if r == nil {
		return strings.TrimSpace(text)
	}

	out, err := r.Render(text)
	if err != nil {
		return strings.TrimSpace(text)
	}
	// Glamour adds trailing newlines; trim them for inline embedding in the log view.
	return strings.TrimRight(out, "\n")
}

// getRenderer returns a cached glamour.TermRenderer, recreating it when the
// target width changes.
func getRenderer(width int) *glamour.TermRenderer {
	mdRenderer.mu.Lock()
	defer mdRenderer.mu.Unlock()

	if mdRenderer.renderer != nil && mdRenderer.width == width {
		return mdRenderer.renderer
	}

	// Default to 80 columns when the width is unknown.
	wrap := width
	if wrap <= 0 {
		wrap = 80
	}

	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(wrap),
	)
	if err != nil {
		return nil
	}

	mdRenderer.renderer = r
	mdRenderer.width = width
	return r
}
