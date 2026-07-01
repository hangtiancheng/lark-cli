package tui

import (
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

// connectedMsg is emitted when the TUI successfully connects to the daemon
// and creates a chat session. It carries the live client and event channel
// so the Model can adopt them (the Model is a value type, so the connect
// command cannot mutate it directly).
type connectedMsg struct {
	sessionID string
	client    *transport.Client
	eventCh   chan eventMsg
}

// disconnectedMsg is emitted when the connection to the daemon is lost,
// triggering the reconnection loop.
type disconnectedMsg struct{}

// reconnectMsg is an internal tick to retry connecting after a delay.
type reconnectMsg struct{}

// eventMsg wraps a single daemon event forwarded to the TUI for rendering.
type eventMsg struct {
	eventType string
	data      map[string]any
}

// errorMsg carries an error string to display in the TUI.
type errorMsg struct {
	err string
}

// permissionDecidedMsg is emitted after the user responds to a permission
// request, carrying the tool_use_id and the decision string.
type permissionDecidedMsg struct {
	toolUseID string
	decision  string
}

// slashChangedMsg signals that the input prefix changed, toggling the
// slash-command completion popup. A nil query dismisses the popup.
type slashChangedMsg struct {
	query string
	open  bool
}

// slashSelectedMsg signals that the user selected a skill from the popup.
type slashSelectedMsg struct {
	name string
}

// inputSubmittedMsg signals that the user pressed Enter to submit input.
type inputSubmittedMsg struct {
	value string
}

// compactResultMsg carries the result of a /compact command.
type compactResultMsg struct {
	summaryTokens int
	savedTokens   int
	err           string
}
