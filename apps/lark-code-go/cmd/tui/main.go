package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

const tuiVersion = "0.1.0"

// -- Styles --

var (
	// Colors
	primaryColor = lipgloss.Color("#8B5CF6") // violet
	successColor = lipgloss.Color("#10B981") // green
	errorColor   = lipgloss.Color("#EF4444") // red
	warningColor = lipgloss.Color("#F59E0B") // amber
	dimColor     = lipgloss.Color("#6B7280") // gray
	accentColor  = lipgloss.Color("#3B82F6") // blue
	toolColor    = lipgloss.Color("#EC4899") // pink

	// Styles
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(primaryColor)

	subtitleStyle = lipgloss.NewStyle().
			Foreground(dimColor)

	successStyle = lipgloss.NewStyle().
			Foreground(successColor)

	errorStyle = lipgloss.NewStyle().
			Foreground(errorColor)

	warningStyle = lipgloss.NewStyle().
			Foreground(warningColor)

	dimStyle = lipgloss.NewStyle().
			Foreground(dimColor)

	accentStyle = lipgloss.NewStyle().
			Foreground(accentColor)

	toolStyle = lipgloss.NewStyle().
			Foreground(toolColor)

	cardStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(dimColor).
			Padding(0, 1)

	inputStyle = lipgloss.NewStyle().
			Foreground(primaryColor).
			Bold(true)

	cursorStyle = lipgloss.NewStyle().
			Foreground(primaryColor).
			Blink(true)

	statusBarStyle = lipgloss.NewStyle().
			Foreground(dimColor).
			BorderStyle(lipgloss.NormalBorder()).
			BorderTop(true).
			BorderForeground(dimColor)

	permissionStyle = lipgloss.NewStyle().
			Border(lipgloss.DoubleBorder()).
			BorderForeground(warningColor).
			Padding(0, 1).
			Margin(1, 0)

	completionStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(accentColor).
			Padding(0, 1)
)

// -- Model --

type model struct {
	client    *transport.Client
	connected bool
	sessionID string
	events    []eventEntry
	eventCh   chan eventMsg

	inputValue  string
	inputCursor int
	status      string // "idle", "running", "waiting", "connecting"
	width       int
	height      int
	err         string

	// Permission request state
	permRequest *permissionRequest

	// Usage stats
	usage *usageStats

	// Slash command completion
	showCompletion  bool
	completionItems []completionItem
	completionIdx   int
}

type eventEntry struct {
	eventType string
	data      map[string]any
	rendered  string
}

type permissionRequest struct {
	toolUseID    string
	toolName     string
	paramPreview string
}

type usageStats struct {
	inputTokens  int
	outputTokens int
	cacheRead    int
	contextPct   float64
}

type completionItem struct {
	name        string
	description string
}

// -- Messages --

type connectedMsg struct {
	sessionID string
}

type disconnectedMsg struct{}

type eventMsg struct {
	eventType string
	data      map[string]any
}

type errorMsg struct {
	err string
}

// -- Init --

func (m model) Init() tea.Cmd {
	return tea.Batch(m.connect(), m.waitForEvent())
}

func (m *model) connect() tea.Cmd {
	return func() tea.Msg {
		cfg, err := config.GetConfig()
		if err != nil {
			return errorMsg{err: fmt.Sprintf("config error: %s", err)}
		}

		client := transport.NewClient(cfg.Host, cfg.Port)
		if err := client.Connect(); err != nil {
			return errorMsg{err: fmt.Sprintf("connect failed: %s", err)}
		}

		// Create the event channel for forwarding server events
		eventCh := make(chan eventMsg, 256)

		// Subscribe to server-side events and forward to channel
		client.OnEvent(func(event json.RawMessage) error {
			var evt struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(event, &evt); err != nil {
				return nil
			}

			var data map[string]any
			_ = json.Unmarshal(event, &data)

			// Non-blocking send to avoid blocking the reader goroutine
			select {
			case eventCh <- eventMsg{eventType: evt.Type, data: data}:
			default:
				// Drop event if channel is full
			}
			return nil
		})

		// Create a new session on the daemon
		result, err := client.SendCommand("session.create", map[string]any{
			"mode":  "chat",
			"title": "TUI Session",
		})
		if err != nil {
			return errorMsg{err: fmt.Sprintf("session.create failed: %s", err)}
		}

		var sessionResult struct {
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(result, &sessionResult); err != nil {
			return errorMsg{err: fmt.Sprintf("parse error: %s", err)}
		}

		m.client = client
		m.eventCh = eventCh
		return connectedMsg{sessionID: sessionResult.SessionID}
	}
}

// waitForEvent returns a Bubble Tea command that blocks until an event arrives.
func (m *model) waitForEvent() tea.Cmd {
	return func() tea.Msg {
		if m.eventCh == nil {
			return nil
		}
		evt, ok := <-m.eventCh
		if !ok {
			return nil
		}
		return evt
	}
}

// -- Update --

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		// Permission dialog key handlers (take priority when dialog is active)
		if m.permRequest != nil {
			switch msg.String() {
			case "y":
				return m, m.respondPermission("allow_once")
			case "n":
				return m, m.respondPermission("deny_once")
			case "a":
				return m, m.respondPermission("always_allow")
			case "d":
				return m, m.respondPermission("always_deny")
			}
		}

		switch msg.String() {
		case "ctrl+c":
			if m.client != nil {
				m.client.Close()
			}
			return m, tea.Quit

		case "tab":
			if m.showCompletion && len(m.completionItems) > 0 {
				m.completionIdx = (m.completionIdx + 1) % len(m.completionItems)
			}
			return m, nil

		case "enter":
			// Slash completion selection
			if m.showCompletion && len(m.completionItems) > 0 {
				selected := m.completionItems[m.completionIdx]
				m.inputValue = "/" + selected.name + " "
				m.showCompletion = false
				return m, nil
			}
			// Normal message send
			if m.inputValue != "" && m.connected && m.status == "idle" {
				text := m.inputValue
				m.inputValue = ""
				m.status = "running"
				return m, m.sendMessage(text)
			}

		case "backspace":
			if len(m.inputValue) > 0 {
				m.inputValue = m.inputValue[:len(m.inputValue)-1]
				m.updateCompletion()
			}

		case "up":
			if m.showCompletion && len(m.completionItems) > 0 {
				if m.completionIdx > 0 {
					m.completionIdx--
				}
			}

		case "down":
			if m.showCompletion && len(m.completionItems) > 0 {
				if m.completionIdx < len(m.completionItems)-1 {
					m.completionIdx++
				}
			}

		default:
			if len(msg.String()) == 1 {
				m.inputValue += msg.String()
				m.updateCompletion()
			}
		}
		return m, nil

	case connectedMsg:
		m.connected = true
		m.sessionID = msg.sessionID
		m.status = "idle"
		m.err = ""
		m.events = append(m.events, eventEntry{
			eventType: "system",
			rendered:  fmt.Sprintf("Connected to session %s", msg.sessionID[:min(16, len(msg.sessionID))]),
		})
		return m, m.waitForEvent()

	case disconnectedMsg:
		m.connected = false
		m.status = "connecting"
		m.events = append(m.events, eventEntry{
			eventType: "system",
			rendered:  "Disconnected, reconnecting...",
		})
		return m, m.connect()

	case eventMsg:
		rendered := renderEvent(msg.eventType, msg.data)
		m.events = append(m.events, eventEntry{
			eventType: msg.eventType,
			data:      msg.data,
			rendered:  rendered,
		})

		// Status updates from events
		if msg.eventType == "run.finished" || msg.eventType == "session.waiting_for_input" {
			m.status = "idle"
		}
		if msg.eventType == "run.started" {
			m.status = "running"
		}

		// Permission request handling
		if msg.eventType == "permission.requested" {
			toolUseID, _ := msg.data["tool_use_id"].(string)
			toolName, _ := msg.data["tool_name"].(string)
			paramPreview, _ := msg.data["param_preview"].(string)
			m.permRequest = &permissionRequest{
				toolUseID:    toolUseID,
				toolName:     toolName,
				paramPreview: paramPreview,
			}
		}
		if msg.eventType == "permission.granted" || msg.eventType == "permission.denied" {
			m.permRequest = nil
		}

		// Usage stats tracking
		if msg.eventType == "llm.usage" {
			inputTokens, _ := msg.data["input_tokens"].(float64)
			outputTokens, _ := msg.data["output_tokens"].(float64)
			cacheRead, _ := msg.data["cache_read_input_tokens"].(float64)
			contextPct, _ := msg.data["context_pct"].(float64)
			m.usage = &usageStats{
				inputTokens:  int(inputTokens),
				outputTokens: int(outputTokens),
				cacheRead:    int(cacheRead),
				contextPct:   contextPct,
			}
		}

		// Continue listening for events
		return m, m.waitForEvent()

	case errorMsg:
		m.err = msg.err
		return m, nil
	}

	return m, nil
}

func (m *model) sendMessage(text string) tea.Cmd {
	return func() tea.Msg {
		if m.client == nil {
			return errorMsg{err: "not connected"}
		}
		_, err := m.client.SendCommand("session.send_message", map[string]any{
			"session_id": m.sessionID,
			"content":    text,
		})
		if err != nil {
			return errorMsg{err: fmt.Sprintf("send failed: %s", err)}
		}
		return nil
	}
}

func (m *model) respondPermission(decision string) tea.Cmd {
	toolUseID := m.permRequest.toolUseID
	return func() tea.Msg {
		if m.client == nil {
			return errorMsg{err: "not connected"}
		}
		_, err := m.client.SendCommand("permission.respond", map[string]any{
			"tool_use_id": toolUseID,
			"decision":    decision,
		})
		if err != nil {
			return errorMsg{err: fmt.Sprintf("permission respond failed: %s", err)}
		}
		return nil
	}
}

// -- Slash Command Completion --

// builtinSkillNames lists the built-in skill names for completion.
var builtinSkillNames = []completionItem{
	{name: "init", description: "Analyze project structure and generate context.md"},
	{name: "orchestrate", description: "Plan, execute, and review a multi-step task"},
	{name: "review", description: "Review code changes with severity classification"},
	{name: "summarize", description: "Compress session into a readable summary"},
}

func (m *model) updateCompletion() {
	if !strings.HasPrefix(m.inputValue, "/") || strings.Contains(m.inputValue[1:], " ") {
		m.showCompletion = false
		return
	}

	prefix := strings.TrimPrefix(m.inputValue, "/")
	var matches []completionItem
	for _, item := range builtinSkillNames {
		if strings.HasPrefix(item.name, prefix) {
			matches = append(matches, item)
		}
	}

	m.completionItems = matches
	m.completionIdx = 0
	m.showCompletion = len(matches) > 0
}

// -- View --

func (m model) View() string {
	var b strings.Builder

	// Header
	b.WriteString(m.renderHeader())
	b.WriteString("\n")

	// Events
	maxEvents := m.height - 6 // header + status + input + padding
	if m.permRequest != nil {
		maxEvents -= 5 // permission dialog takes ~5 lines
	}
	if m.showCompletion && len(m.completionItems) > 0 {
		maxEvents -= len(m.completionItems) + 2
	}
	if maxEvents < 3 {
		maxEvents = 3
	}

	start := 0
	if len(m.events) > maxEvents {
		start = len(m.events) - maxEvents
	}

	for _, evt := range m.events[start:] {
		b.WriteString(evt.rendered)
		b.WriteString("\n")
	}

	// Slash completion popup
	if m.showCompletion && len(m.completionItems) > 0 {
		b.WriteString("\n")
		b.WriteString(m.renderCompletion())
		b.WriteString("\n")
	}

	// Permission request
	if m.permRequest != nil {
		b.WriteString("\n")
		b.WriteString(m.renderPermission())
		b.WriteString("\n")
	}

	// Status bar
	b.WriteString("\n")
	b.WriteString(m.renderStatusBar())
	b.WriteString("\n")

	// Input
	b.WriteString(m.renderInput())

	return b.String()
}

func (m model) renderHeader() string {
	var parts []string

	// Logo and version
	parts = append(parts, titleStyle.Render("lark"))
	parts = append(parts, subtitleStyle.Render(fmt.Sprintf("v%s", tuiVersion)))

	// Connection indicator
	if m.connected {
		parts = append(parts, successStyle.Render("●"))
	} else {
		parts = append(parts, errorStyle.Render("○"))
	}

	// Session ID
	if m.sessionID != "" {
		parts = append(parts, dimStyle.Render(m.sessionID[:min(16, len(m.sessionID))]))
	}

	// Error
	if m.err != "" {
		parts = append(parts, errorStyle.Render(fmt.Sprintf("err: %s", m.err)))
	}

	return strings.Join(parts, " ")
}

func (m model) renderStatusBar() string {
	var parts []string

	// Status
	switch m.status {
	case "running":
		parts = append(parts, accentStyle.Render("● running"))
	case "idle":
		parts = append(parts, successStyle.Render("● idle"))
	case "connecting":
		parts = append(parts, warningStyle.Render("○ connecting"))
	default:
		parts = append(parts, dimStyle.Render(fmt.Sprintf("● %s", m.status)))
	}

	// Event count
	parts = append(parts, dimStyle.Render(fmt.Sprintf("events: %d", len(m.events))))

	// Usage stats
	if m.usage != nil {
		parts = append(parts, dimStyle.Render(fmt.Sprintf(
			"tokens: %d in / %d out / %d cache",
			m.usage.inputTokens, m.usage.outputTokens, m.usage.cacheRead,
		)))
		// Context percentage bar
		pct := int(m.usage.contextPct * 100)
		bar := renderProgressBar(pct, 15)
		parts = append(parts, dimStyle.Render(fmt.Sprintf("ctx: %s %d%%", bar, pct)))
	}

	return statusBarStyle.Width(m.width).Render(strings.Join(parts, "  "))
}

func (m model) renderInput() string {
	prompt := inputStyle.Render(">")
	if m.status == "running" {
		prompt = dimStyle.Render(">")
	}

	cursor := cursorStyle.Render("█")
	if m.status == "running" {
		cursor = dimStyle.Render("█")
	}

	return fmt.Sprintf("%s %s%s", prompt, m.inputValue, cursor)
}

func (m model) renderPermission() string {
	if m.permRequest == nil {
		return ""
	}

	var b strings.Builder
	b.WriteString(warningStyle.Render("Permission Request"))
	b.WriteString("\n\n")
	b.WriteString(fmt.Sprintf("Tool: %s\n", toolStyle.Render(m.permRequest.toolName)))
	b.WriteString(fmt.Sprintf("Parameters: %s\n", dimStyle.Render(m.permRequest.paramPreview)))
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("[y] allow  [n] deny  [a] always allow  [d] always deny"))

	return permissionStyle.Render(b.String())
}

func (m model) renderCompletion() string {
	var items []string
	for i, item := range m.completionItems {
		if i == m.completionIdx {
			items = append(items, accentStyle.Render(fmt.Sprintf("▸ %-14s %s", item.name, dimStyle.Render(item.description))))
		} else {
			items = append(items, dimStyle.Render(fmt.Sprintf("  %-14s %s", item.name, item.description)))
		}
	}
	return completionStyle.Render(strings.Join(items, "\n"))
}

func renderEvent(eventType string, data map[string]any) string {
	switch eventType {
	case "llm.token":
		token, _ := data["token"].(string)
		return token

	case "run.started":
		goal, _ := data["goal"].(string)
		return accentStyle.Render(fmt.Sprintf("▶ %s", truncate(goal, 80)))

	case "run.finished":
		status, _ := data["status"].(string)
		steps, _ := data["steps"].(float64)
		if status == "success" {
			return successStyle.Render(fmt.Sprintf("✓ Completed in %d steps", int(steps)))
		}
		reason, _ := data["reason"].(string)
		return errorStyle.Render(fmt.Sprintf("✗ Failed: %s", reason))

	case "tool.call_started":
		name, _ := data["tool_name"].(string)
		return toolStyle.Render(fmt.Sprintf("⚙ %s", name))

	case "tool.call_finished":
		name, _ := data["tool_name"].(string)
		elapsed, _ := data["elapsed_ms"].(float64)
		return dimStyle.Render(fmt.Sprintf("✓ %s (%.0fms)", name, elapsed))

	case "tool.call_failed":
		name, _ := data["tool_name"].(string)
		errMsg, _ := data["error_message"].(string)
		return errorStyle.Render(fmt.Sprintf("✗ %s: %s", name, truncate(errMsg, 60)))

	case "permission.requested":
		toolName, _ := data["tool_name"].(string)
		return warningStyle.Render(fmt.Sprintf("? Permission requested: %s", toolName))

	case "permission.granted":
		return successStyle.Render("✓ Permission granted")

	case "permission.denied":
		return errorStyle.Render("✗ Permission denied")

	case "context.compacted":
		return dimStyle.Render("↻ Context compacted")

	case "skill.invoked":
		skillName, _ := data["skill_name"].(string)
		return accentStyle.Render(fmt.Sprintf("⚡ Skill: %s", skillName))

	case "session.resumed":
		return dimStyle.Render("↻ Session resumed")

	case "llm.usage":
		// Usage is rendered in the status bar, not as an event line
		return ""

	case "system":
		text, _ := data["text"].(string)
		return dimStyle.Render(fmt.Sprintf("· %s", text))

	default:
		return dimStyle.Render(fmt.Sprintf("  %s", eventType))
	}
}

// renderProgressBar renders a progress bar with color coding.
func renderProgressBar(pct, width int) string {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	filled := pct * width / 100
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	if pct > 80 {
		return warningStyle.Render(bar)
	}
	if pct > 60 {
		return accentStyle.Render(bar)
	}
	return successStyle.Render(bar)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func main() {
	m := model{
		status: "connecting",
	}
	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}
