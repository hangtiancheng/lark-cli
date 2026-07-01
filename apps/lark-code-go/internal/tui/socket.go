package tui

import (
	"encoding/json"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

// connect establishes a TCP connection to the daemon, subscribes to events,
// and creates a chat session. Emits connectedMsg on success or errorMsg on
// failure. Mirrors the connection phase of Python's _socket_loop.
func (m Model) connect() tea.Cmd {
	return func() tea.Msg {
		client := transport.NewClient(m.host, m.port)
		if err := client.Connect(); err != nil {
			return errorMsg{err: fmt.Sprintf("connect failed: %s", err)}
		}

		// Set up the event forwarding channel.
		eventCh := make(chan eventMsg, 256)
		client.OnEvent(func(event json.RawMessage) error {
			var probe struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(event, &probe); err != nil {
				return nil
			}
			var data map[string]any
			_ = json.Unmarshal(event, &data)
			select {
			case eventCh <- eventMsg{eventType: probe.Type, data: data}:
			default:
				// Drop event if channel is full to avoid blocking the reader.
			}
			return nil
		})

		// Subscribe to all relevant event topics.
		subscribeParams := map[string]any{
			"topics": []string{
				"session.*",
				"run.*",
				"step.*",
				"tool.*",
				"llm.token",
				"llm.usage",
				"log.*",
				"permission.*",
				"context.*",
				"subagent.*",
				"skill.*",
			},
			"scope": "global",
		}
		if m.replayRunID != "" {
			subscribeParams["replay_from_run"] = m.replayRunID
		}
		if _, err := client.SendCommand("event.subscribe", subscribeParams); err != nil {
			client.Close()
			return errorMsg{err: fmt.Sprintf("subscribe failed: %s", err)}
		}

		// Create a chat session.
		result, err := client.SendCommand("session.create", map[string]any{
			"mode":  "chat",
			"title": "lark-tui",
		})
		if err != nil {
			client.Close()
			return errorMsg{err: fmt.Sprintf("session.create failed: %s", err)}
		}
		var sessResult struct {
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(result, &sessResult); err != nil {
			client.Close()
			return errorMsg{err: fmt.Sprintf("parse session result: %s", err)}
		}

		// Store the client and channel on the model via a pointer-safe copy.
		// Bubble Tea models are values, so we pass the client and channel back
		// through the connectedMsg; the Update handler assigns them to the model.
		_ = client

		// Launch a goroutine to detect disconnection and emit disconnectedMsg.
		go func() {
			<-client.WaitForDisconnect()
			// We cannot directly send to the program here; instead we rely on
			// the eventCh closing (waitForEvent will return). The disconnectedMsg
			// is emitted when waitForEvent sees a closed channel.
		}()

		return connectedMsg{sessionID: sessResult.SessionID, client: client, eventCh: eventCh}
	}
}

// waitForEvent blocks until the next event arrives on the event channel.
// It also selects on the client's disconnect channel so that a lost
// connection is detected even when no events are flowing. Emits
// disconnectedMsg when the channel closes or the connection drops.
func (m Model) waitForEvent() tea.Cmd {
	return func() tea.Msg {
		if m.eventCh == nil {
			return nil
		}
		// If we have a client, also watch its disconnect signal.
		var disconnectCh <-chan struct{}
		if m.client != nil {
			disconnectCh = m.client.WaitForDisconnect()
		}
		select {
		case evt, ok := <-m.eventCh:
			if !ok {
				return disconnectedMsg{}
			}
			return evt
		case <-disconnectCh:
			return disconnectedMsg{}
		}
	}
}

// handleInputSubmit processes a submitted input value: either a /compact
// command, a slash-command skill invocation, or a normal chat message.
func (m Model) handleInputSubmit(value string) (tea.Model, tea.Cmd) {
	text := strings.TrimSpace(value)
	if text == "" {
		return m, nil
	}

	// Clear the input box.
	m.input.Reset()
	m.showCompletion = false

	// /compact command
	if text == "/compact" {
		if m.busy || !m.connected {
			m.append(staticLine(warningStyle.Render("agent busy or disconnected")))
			return m, nil
		}
		m.append(staticLine(userTurnStyle.Render("> " + text)))
		m.append(staticLine(dimStyle.Render("⚡ compacting context...")))
		return m, m.doCompact()
	}

	// Slash command (skill invocation) — sent as a normal message; the daemon
	// parses the leading / to trigger skill handling.
	if strings.HasPrefix(text, "/") {
		return m.sendMessage(text)
	}

	// Normal message
	return m.sendMessage(text)
}

// sendMessage sends a chat message to the daemon and marks the agent busy.
func (m Model) sendMessage(text string) (tea.Model, tea.Cmd) {
	if m.client == nil || m.sessionID == "" {
		m.append(staticLine(errorStyle.Render("not connected")))
		return m, nil
	}

	// Echo the user's message to the log view.
	m.append(staticLine(userTurnStyle.Render("> " + text)))
	m.busy = true
	m.status = statusRunning
	m.input.SetEnabled(false)
	m.input.SetBorderTitle("agent is working...")

	sessionID := m.sessionID
	client := m.client
	return m, func() tea.Msg {
		_, err := client.SendCommand("session.send_message", map[string]any{
			"session_id": sessionID,
			"content":    text,
		})
		if err != nil {
			return errorMsg{err: fmt.Sprintf("send failed: %s", err)}
		}
		return nil
	}
}

// respondPermission sends a permission.respond command for the active request
// and emits a permissionDecidedMsg so the model can resolve the block.
func (m Model) respondPermission(decision string) tea.Cmd {
	if m.permSelect == nil {
		return nil
	}
	toolUseID := m.permSelect.ToolUseID()
	client := m.client
	return func() tea.Msg {
		if client != nil {
			_, _ = client.SendCommand("permission.respond", map[string]any{
				"tool_use_id": toolUseID,
				"decision":    decision,
			})
		}
		return permissionDecidedMsg{toolUseID: toolUseID, decision: decision}
	}
}

// handlePermissionDecided resolves the permission block and re-enables input
// when no more permissions are pending.
func (m Model) handlePermissionDecided(msg permissionDecidedMsg) (tea.Model, tea.Cmd) {
	if pb, ok := m.pendingPerms[msg.toolUseID]; ok {
		pb.Resolve(msg.decision)
		delete(m.pendingPerms, msg.toolUseID)
	}
	if m.permSelect != nil && m.permSelect.ToolUseID() == msg.toolUseID {
		m.permSelect = nil
	}
	if len(m.pendingPerms) == 0 {
		m.input.SetEnabled(true)
		m.input.SetBorderTitle("type a message")
	}
	return m, nil
}

// doCompact sends a session.compact request to the daemon.
func (m Model) doCompact() tea.Cmd {
	sessionID := m.sessionID
	client := m.client
	return func() tea.Msg {
		if client == nil {
			return compactResultMsg{err: "not connected"}
		}
		result, err := client.SendCommand("session.compact", map[string]any{
			"session_id": sessionID,
			"focus":      "",
		})
		if err != nil {
			return compactResultMsg{err: err.Error()}
		}
		var res struct {
			SummaryTokens int `json:"summary_tokens"`
			SavedTokens   int `json:"saved_tokens"`
		}
		_ = json.Unmarshal(result, &res)
		return compactResultMsg{
			summaryTokens: res.SummaryTokens,
			savedTokens:   res.SavedTokens,
		}
	}
}

// handleCompactResult renders the compact result in the log view.
func (m Model) handleCompactResult(msg compactResultMsg) (tea.Model, tea.Cmd) {
	if msg.err != "" {
		m.append(staticLine(errorStyle.Render("compact error: " + msg.err)))
		return m, nil
	}
	m.lastContextPct = 0
	m.append(staticLine(fmt.Sprintf("%s  %s",
		accentStyle.Bold(true).Render("⚡ Context compacted"),
		dimStyle.Render(fmt.Sprintf("summary=%d tokens  saved≈%d tokens", msg.summaryTokens, msg.savedTokens)))))
	m.busy = false
	m.status = statusReady
	m.input.SetEnabled(true)
	m.input.SetBorderTitle("type a message")
	return m, nil
}
