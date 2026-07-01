package tui

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

// Version is the TUI client version.
const Version = "0.1.0"

// status constants for the connection/agent state.
const (
	statusConnecting   = "connecting"
	statusReady        = "ready"
	statusRunning      = "running"
	statusDisconnected = "disconnected"
)

// renderable is implemented by any log-view entry that can be drawn.
type renderable interface {
	Render(width int) string
}

// staticLine is a pre-rendered string entry in the log view.
type staticLine string

func (s staticLine) Render(width int) string { return string(s) }

// usageStats tracks the most recent LLM token usage.
type usageStats struct {
	inputTokens  int
	outputTokens int
	cacheRead    int
	contextPct   float64
}

// Model is the top-level Bubble Tea model for the TUI.
type Model struct {
	// Connection
	host         string
	port         int
	replayRunID  string
	client       *transport.Client
	connected    bool
	sessionID    string
	eventCh      chan eventMsg
	reconnecting bool

	// Display
	width  int
	height int
	status string
	errMsg string

	// Log view entries (each is a renderable)
	entries []renderable

	// LLM streaming state
	currentLLM *StreamBlock

	// Tool call blocks awaiting results (tool_use_id -> *ToolBlock)
	pendingTools map[string]*ToolBlock

	// Permission state
	pendingPerms map[string]*PermissionBlock
	permSelect   *PermissionSelect

	// Subagent tracking (child run_id -> description)
	subagentRunIDs     map[string]string
	subagentStartTimes map[string]time.Time

	// Slash completion
	completion     *CompletionPopup
	showCompletion bool

	// Input
	input *InputBox

	// Usage
	usage          *usageStats
	lastContextPct float64

	// Agent busy flag
	busy bool
}

// New creates a new TUI Model from the loaded configuration.
func New(cfg *config.Config, replayRunID string) Model {
	m := Model{
		host:               cfg.Host,
		port:               cfg.Port,
		replayRunID:        replayRunID,
		status:             statusConnecting,
		pendingTools:       make(map[string]*ToolBlock),
		pendingPerms:       make(map[string]*PermissionBlock),
		subagentRunIDs:     make(map[string]string),
		subagentStartTimes: make(map[string]time.Time),
		input:              NewInputBox(),
		completion:         NewCompletionPopup(currentProjectDir()),
	}
	// Prepend the banner to the log view.
	m.entries = append(m.entries, staticLine(bannerStyle.Render(banner)))
	m.entries = append(m.entries, staticLine(dimStyle.Render(bannerHint)))
	m.entries = append(m.entries, staticLine(""))
	return m
}

// Init starts the TUI by launching the socket connection loop.
func (m Model) Init() tea.Cmd {
	return m.connect()
}

// Update handles all incoming messages.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.input.SetWidth(msg.Width)
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case connectedMsg:
		m.connected = true
		m.sessionID = msg.sessionID
		m.client = msg.client
		m.eventCh = msg.eventCh
		m.status = statusReady
		m.errMsg = ""
		m.append(staticLine(successStyle.Render("● connected") +
			"  " + dimStyle.Render(shortID(msg.sessionID))))
		m.input.SetBorderTitle("type a message")
		m.input.SetEnabled(true)
		return m, m.waitForEvent()

	case disconnectedMsg:
		m.connected = false
		m.status = statusDisconnected
		m.breakLLM()
		m.input.SetEnabled(false)
		m.input.SetBorderTitle("disconnected, retrying...")
		m.append(staticLine(errorStyle.Render("○ disconnected, retrying...")))
		// Schedule a reconnection attempt after 2 seconds.
		return m, tea.Tick(2*time.Second, func(time.Time) tea.Msg { return reconnectMsg{} })

	case reconnectMsg:
		if m.connected {
			return m, nil
		}
		m.status = statusConnecting
		return m, m.connect()

	case eventMsg:
		m.handleEvent(msg.eventType, msg.data)
		return m, m.waitForEvent()

	case errorMsg:
		m.errMsg = msg.err
		m.append(staticLine(errorStyle.Render("error: " + msg.err)))
		return m, nil

	case permissionDecidedMsg:
		return m.handlePermissionDecided(msg)

	case slashChangedMsg:
		return m.handleSlashChanged(msg)

	case slashSelectedMsg:
		m.input.SetValue("/" + msg.name + " ")
		m.showCompletion = false
		return m, nil

	case inputSubmittedMsg:
		return m.handleInputSubmit(msg.value)

	case compactResultMsg:
		return m.handleCompactResult(msg)
	}

	return m, nil
}

// handleKey routes key events to the appropriate handler based on current state.
func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Global: ctrl+c quits.
	if msg.String() == "ctrl+c" {
		if m.client != nil {
			m.client.Close()
		}
		return m, tea.Quit
	}

	// Tab toggles the latest tool block expansion.
	if msg.String() == "tab" && !m.showCompletion {
		if cmd := m.toggleLatestToolBlock(); cmd != nil {
			return m, cmd
		}
		return m, nil
	}

	// Permission select takes priority when active.
	if m.permSelect != nil {
		return m.handlePermissionKey(msg)
	}

	// Slash completion navigation when popup is visible.
	if m.showCompletion && m.completion != nil {
		switch msg.String() {
		case "up":
			m.completion.MoveUp()
			return m, nil
		case "down":
			m.completion.MoveDown()
			return m, nil
		case "tab", "enter":
			if name := m.completion.SelectedName(); name != "" {
				return m, func() tea.Msg { return slashSelectedMsg{name: name} }
			}
			return m, nil
		case "esc":
			m.showCompletion = false
			return m, nil
		}
		// Fall through to input for other keys.
	}

	// Intercept Enter / Shift+Enter before the textarea sees them.
	if handled, cmd := m.input.HandleKey(msg); handled {
		// After handling, re-check slash state.
		return m, tea.Batch(cmd, m.input.checkSlash())
	}

	// Pass through to the textarea.
	var taCmd tea.Cmd
	newInput, taCmd, _ := m.input.Update(msg)
	m.input = newInput
	return m, tea.Batch(taCmd, m.input.checkSlash())
}

// handlePermissionKey routes keys to the permission select widget.
func (m Model) handlePermissionKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	// Quick-select via y/a/n/d.
	if decision, ok := m.permSelect.LookupKey(key); ok {
		return m, m.respondPermission(decision)
	}

	switch key {
	case "up", "k":
		m.permSelect.MoveUp()
		return m, nil
	case "down", "j":
		m.permSelect.MoveDown()
		return m, nil
	case "enter":
		return m, m.respondPermission(m.permSelect.CurrentDecision())
	}

	// Ignore other keys while the permission dialog is active.
	return m, nil
}

// handleSlashChanged shows/hides the completion popup based on input.
func (m Model) handleSlashChanged(msg slashChangedMsg) (tea.Model, tea.Cmd) {
	if !msg.open {
		m.showCompletion = false
		return m, nil
	}
	m.showCompletion = true
	m.completion.SetQuery(msg.query)
	return m, nil
}

// View renders the full TUI screen.
func (m Model) View() string {
	var b strings.Builder

	// Header
	b.WriteString(m.renderHeader())
	b.WriteString("\n")

	// Log view (fills the middle)
	logHeight := m.logViewHeight()
	visible := m.visibleEntries(logHeight)
	for _, e := range visible {
		b.WriteString(e.Render(m.width))
		b.WriteString("\n")
	}

	// Completion popup (if visible)
	if m.showCompletion && m.completion != nil {
		b.WriteString("\n")
		b.WriteString(m.completion.Render(m.width))
		b.WriteString("\n")
	}

	// Permission select (if active)
	if m.permSelect != nil {
		b.WriteString("\n")
		b.WriteString(m.permSelect.Render(m.width))
		b.WriteString("\n")
	}

	// Status bar
	b.WriteString("\n")
	b.WriteString(m.renderStatusBar())
	b.WriteString("\n")

	// Input box
	b.WriteString(m.input.Render())

	return b.String()
}

// renderHeader produces the top status line.
func (m Model) renderHeader() string {
	var parts []string
	parts = append(parts, titleStyle.Render("lark"))
	parts = append(parts, subtitleStyle.Render("v"+Version))

	// Connection indicator
	if m.connected {
		parts = append(parts, successStyle.Render("●"))
	} else {
		parts = append(parts, errorStyle.Render("○"))
	}

	// Address
	parts = append(parts, dimStyle.Render(fmt.Sprintf("%s:%d", m.host, m.port)))

	// Session ID
	if m.sessionID != "" {
		parts = append(parts, dimStyle.Render(shortID(m.sessionID)))
	}

	// Status badge
	var statusBadge string
	switch m.status {
	case statusReady:
		statusBadge = successStyle.Render("ready")
	case statusRunning:
		statusBadge = warningStyle.Render("running")
	case statusConnecting:
		statusBadge = dimStyle.Render("connecting")
	case statusDisconnected:
		statusBadge = errorStyle.Render("disconnected")
	default:
		statusBadge = dimStyle.Render(m.status)
	}
	parts = append(parts, statusBadge)

	return strings.Join(parts, " ")
}

// renderStatusBar produces the bottom status bar.
func (m Model) renderStatusBar() string {
	var parts []string

	// Busy indicator
	if m.busy {
		parts = append(parts, warningStyle.Render("● working"))
	} else if m.connected {
		parts = append(parts, successStyle.Render("● idle"))
	}

	// Event count
	parts = append(parts, dimStyle.Render(fmt.Sprintf("events: %d", len(m.entries))))

	// Usage stats
	if m.usage != nil {
		parts = append(parts, dimStyle.Render(fmt.Sprintf(
			"tokens: %d in / %d out / %d cache",
			m.usage.inputTokens, m.usage.outputTokens, m.usage.cacheRead,
		)))
		// Context percentage bar
		pct := m.usage.contextPct * 100
		bar := renderProgressBar(m.usage.contextPct, 15)
		parts = append(parts, dimStyle.Render(fmt.Sprintf("ctx: %s %.1f%%", bar, pct)))
	}

	return statusBarStyle.Width(m.width).Render(strings.Join(parts, "  "))
}

// logViewHeight computes the number of rows available for the log view.
func (m Model) logViewHeight() int {
	if m.height == 0 {
		return 20
	}
	// header(1) + statusbar(2) + input(min 3) + spacing(2)
	reserved := 8
	if m.showCompletion && m.completion != nil {
		reserved += m.completion.LineCount() + 1
	}
	if m.permSelect != nil {
		reserved += 7 // 4 options + hint + border + spacing
	}
	h := m.height - reserved
	if h < 3 {
		h = 3
	}
	return h
}

// visibleEntries returns the tail of the entries slice that fits in the
// available height.
func (m Model) visibleEntries(maxLines int) []renderable {
	if len(m.entries) <= maxLines {
		return m.entries
	}
	return m.entries[len(m.entries)-maxLines:]
}

// append adds a new entry to the log view.
func (m *Model) append(e renderable) {
	m.entries = append(m.entries, e)
}

// breakLLM finalizes the current LLM stream block (if any) and clears it.
func (m *Model) breakLLM() {
	if m.currentLLM != nil {
		m.currentLLM.FinalizeMarkdown(m.width)
		m.currentLLM = nil
	}
}

// toggleLatestToolBlock expands/collapses the most recent finished tool block.
func (m Model) toggleLatestToolBlock() tea.Cmd {
	for i := len(m.entries) - 1; i >= 0; i-- {
		if tb, ok := m.entries[i].(*ToolBlock); ok {
			tb.Toggle()
			return nil
		}
	}
	return nil
}

// shortID trims an ID to a short prefix for display.
func shortID(id string) string {
	if len(id) <= 12 {
		return id
	}
	return id[:12]
}

// renderProgressBar renders a context-percentage progress bar with color coding.
func renderProgressBar(pct float64, width int) string {
	filled := int(pct * float64(width))
	if filled > width {
		filled = width
	}
	if filled < 0 {
		filled = 0
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	if pct >= 0.85 {
		return errorStyle.Bold(true).Render(bar)
	}
	if pct >= 0.70 {
		return warningStyle.Render(bar)
	}
	return dimStyle.Render(bar)
}
