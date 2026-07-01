package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// InputBox wraps bubbles/textarea to provide a multi-line chat input that
// submits on Enter and inserts newlines on Shift/Cmd/Alt+Enter.
// Mirrors Python's ChatTextArea.
type InputBox struct {
	ta          textarea.Model
	focused     bool
	width       int
	borderTitle string
}

// NewInputBox creates a new input box with the default configuration.
func NewInputBox() *InputBox {
	ta := textarea.New()
	ta.Placeholder = "type a message — enter to send, ⌘/⇧/⌥+enter for newline"
	ta.ShowLineNumbers = false
	ta.CharLimit = 0 // no limit
	ta.MaxHeight = 12
	// Disable the default Enter→newline binding so Enter can be intercepted
	// by the parent model for message submission.
	ta.KeyMap.InsertNewline = key.NewBinding(key.WithDisabled())
	return &InputBox{
		ta:          ta,
		focused:     true,
		borderTitle: "type a message",
	}
}

// Focus sets focus on the input box.
func (i *InputBox) Focus() tea.Cmd {
	i.focused = true
	return i.ta.Focus()
}

// Blur removes focus from the input box.
func (i *InputBox) Blur() {
	i.focused = false
	i.ta.Blur()
}

// IsFocused reports whether the input box is focused.
func (i *InputBox) IsFocused() bool {
	return i.focused
}

// Value returns the current input text.
func (i *InputBox) Value() string {
	return i.ta.Value()
}

// SetValue sets the input text.
func (i *InputBox) SetValue(s string) {
	i.ta.SetValue(s)
}

// Reset clears the input text.
func (i *InputBox) Reset() {
	i.ta.Reset()
}

// SetWidth sets the usable width for the textarea.
func (i *InputBox) SetWidth(width int) {
	i.width = width
	// Reserve 2 columns for the rounded border on each side.
	if width > 4 {
		i.ta.SetWidth(width - 4)
	} else {
		i.ta.SetWidth(width)
	}
}

// SetBorderTitle sets the text shown in the input box's border title.
func (i *InputBox) SetBorderTitle(title string) {
	i.borderTitle = title
}

// SetEnabled toggles whether the input accepts text (disabled while the agent
// is running or permission is pending).
func (i *InputBox) SetEnabled(enabled bool) {
	// We don't truly disable the textarea (which would drop focus permanently);
	// instead we blur it so it visually appears inactive.
	if enabled {
		i.Focus()
	} else {
		i.Blur()
	}
}

// Update handles key events. It returns the potentially modified input box,
// a tea.Cmd, and a flag indicating whether the event was consumed (and should
// not propagate further).
//
// Special keys:
//   - enter: emits inputSubmittedMsg if the text is non-empty.
//   - shift+enter / alt+enter / ctrl+j: inserts a newline.
//   - up/down: routed to the completion popup when active (handled by caller).
//   - tab/esc: routed to the completion popup when active (handled by caller).
//
// The caller is responsible for invoking checkSlash() after each update to
// drive the completion popup.
func (i *InputBox) Update(msg tea.Msg) (*InputBox, tea.Cmd, bool) {
	// We only intercept key messages; everything else passes through.
	var cmd tea.Cmd
	i.ta, cmd = i.ta.Update(msg)
	return i, cmd, false
}

// HandleKey intercepts a tea.KeyMsg before the textarea sees it. It returns
// (handled, cmd) where handled indicates the caller should not pass the key
// to the textarea.
func (i *InputBox) HandleKey(msg tea.KeyMsg) (bool, tea.Cmd) {
	if !i.focused {
		return false, nil
	}

	key := msg.String()

	// Enter: submit (unless the completion popup is active, which is handled
	// by the caller before reaching here).
	if key == "enter" {
		text := strings.TrimSpace(i.ta.Value())
		if text != "" {
			return true, func() tea.Msg { return inputSubmittedMsg{value: i.ta.Value()} }
		}
		return true, nil
	}

	// Shift/Cmd/Alt+Enter or Ctrl+J: insert a newline.
	if key == "shift+enter" || key == "alt+enter" || key == "ctrl+j" || key == "ctrl+enter" {
		i.ta.SetValue(i.ta.Value() + "\n")
		i.ta.CursorEnd()
		return true, nil
	}

	return false, nil
}

// checkSlash examines the current input and returns a slashChangedMsg if the
// `/`-prefix state changed. The caller dispatches the returned cmd.
func (i *InputBox) checkSlash() tea.Cmd {
	text := i.ta.Value()
	if strings.HasPrefix(text, "/") && !strings.Contains(text[1:], " ") {
		query := text[1:]
		return func() tea.Msg { return slashChangedMsg{query: query, open: true} }
	}
	return func() tea.Msg { return slashChangedMsg{open: false} }
}

// Render produces the display string for the input box, including its border
// and a title line above it.
func (i *InputBox) Render() string {
	style := inputBoxStyle
	if i.focused {
		style = inputBoxFocusStyle
	}

	content := i.ta.View()
	rendered := style.Render(content)
	// Render the border title as a dim prefix line above the box.
	title := dimStyle.Render(i.borderTitle)
	return title + "\n" + rendered
}

// Height returns the rendered height of the input box in rows.
func (i *InputBox) Height() int {
	// title(1) + textarea height + 2 for the border (top + bottom).
	lines := strings.Count(i.ta.Value(), "\n") + 1
	if lines < 1 {
		lines = 1
	}
	if lines > i.ta.MaxHeight {
		lines = i.ta.MaxHeight
	}
	return lines + 3 // title + border
}

// textareaNewlineKey is unused but keeps the lipgloss import alive for
// potential future styling of the textarea internals.
var _ = lipgloss.NewStyle
