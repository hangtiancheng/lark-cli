package permissions

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// pendingEntry tracks a pending approval request's session and response channel.
type pendingEntry struct {
	sessionID string
	ch        chan string
}

// Manager manages the permission approval workflow for tool invocations.
type Manager struct {
	policy     *PolicyStore
	bus        *events.EventBus
	timeoutS   float64
	cwd        string
	policyPath string

	mu      sync.Mutex
	pending map[string]*pendingEntry // tool_use_id -> pendingEntry
	session map[string]Decision      // Session-level permission cache
}

// NewManager creates a new permission Manager.
func NewManager(policy *PolicyStore, busInst *events.EventBus, timeoutS float64, cwd string, policyPath string) *Manager {
	if policy == nil {
		policy = &PolicyStore{Tools: make(map[string]*ToolPolicy)}
	}
	return &Manager{
		policy:     policy,
		bus:        busInst,
		timeoutS:   timeoutS,
		cwd:        cwd,
		policyPath: policyPath,
		pending:    make(map[string]*pendingEntry),
		session:    make(map[string]Decision),
	}
}

// CheckAndWait checks permissions and blocks until user approval is received or timeout occurs.
func (m *Manager) CheckAndWait(
	toolName string,
	toolUseID string,
	params map[string]any,
	sessionID string,
	runID string,
) (Decision, error) {
	// Check the session-level permission cache (keyed by session+tool for per-session approval)
	cacheKey := sessionID + ":" + toolName
	m.mu.Lock()
	if cached, ok := m.session[cacheKey]; ok {
		m.mu.Unlock()
		return cached, nil
	}
	m.mu.Unlock()

	// Evaluate the permission policy
	decision := m.policy.Evaluate(toolName, params, m.cwd)

	switch decision {
	case DecisionAutoAllow:
		return DecisionAllowOnce, nil
	case DecisionAutoDeny:
		return DecisionDenyOnce, nil
	}

	// User approval required
	ch := make(chan string, 1)
	entry := &pendingEntry{sessionID: sessionID, ch: ch}
	m.mu.Lock()
	m.pending[toolUseID] = entry
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.pending, toolUseID)
		m.mu.Unlock()
	}()

	// Publish the permission request event
	paramPreview := buildParamPreview(params)
	m.bus.Publish(&bus.PermissionRequestedEvent{
		Type:         "permission.requested",
		RunID:        runID,
		ToolUseID:    toolUseID,
		ToolName:     toolName,
		Params:       params,
		ParamPreview: paramPreview,
		SessionID:    sessionID,
		TS:           time.Now().UTC().Format(time.RFC3339),
	})

	// Wait for user response or timeout
	var timeoutCh <-chan time.Time
	if m.timeoutS > 0 {
		timeoutCh = time.After(time.Duration(m.timeoutS * float64(time.Second)))
	}

	select {
	case d := <-ch:
		decision := Decision(d)
		// Cache 'always' decisions for the session
		if decision == DecisionAlwaysAllow || decision == DecisionAlwaysDeny {
			m.mu.Lock()
			m.session[cacheKey] = decision
			m.mu.Unlock()
			// Persist to policy.toml
			m.persistAlwaysDecision(toolName, decision)
		}

		// Publish the permission decision event
		if decision == DecisionAllowOnce || decision == DecisionAlwaysAllow || decision == DecisionAutoAllow {
			m.bus.Publish(&bus.PermissionGrantedEvent{
				Type:      "permission.granted",
				RunID:     runID,
				ToolUseID: toolUseID,
				Decision:  string(decision),
				TS:        time.Now().UTC().Format(time.RFC3339),
			})
		} else {
			m.bus.Publish(&bus.PermissionDeniedEvent{
				Type:      "permission.denied",
				RunID:     runID,
				ToolUseID: toolUseID,
				Decision:  string(decision),
				TS:        time.Now().UTC().Format(time.RFC3339),
			})
		}
		return decision, nil

	case <-timeoutCh:
		m.bus.Publish(&bus.PermissionDeniedEvent{
			Type:      "permission.denied",
			RunID:     runID,
			ToolUseID: toolUseID,
			Decision:  "timeout",
			TS:        time.Now().UTC().Format(time.RFC3339),
		})
		return DecisionDenyOnce, fmt.Errorf("permission request timed out")
	}
}

// Respond processes the user's permission decision for a pending request.
func (m *Manager) Respond(toolUseID string, decision string) bool {
	m.mu.Lock()
	entry, ok := m.pending[toolUseID]
	m.mu.Unlock()

	if !ok {
		return false
	}

	entry.ch <- decision
	return true
}

// CancelSession cancels all pending permission requests for the specified session.
func (m *Manager) CancelSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for toolUseID, entry := range m.pending {
		if entry.sessionID != sessionID {
			continue
		}
		select {
		case entry.ch <- "deny_once":
			delete(m.pending, toolUseID)
		default:
			// Channel is full or already closed
		}
	}
}

// persistAlwaysDecision saves an 'always' decision to policy.toml.
func (m *Manager) persistAlwaysDecision(toolName string, decision Decision) {
	if m.policyPath == "" {
		return
	}

	// Update the in-memory policy
	policy, ok := m.policy.Tools[toolName]
	if !ok {
		policy = &ToolPolicy{}
		m.policy.Tools[toolName] = policy
	}

	switch decision {
	case DecisionAlwaysAllow:
		policy.AllowPatterns = appendUnique(policy.AllowPatterns, "*")
	case DecisionAlwaysDeny:
		policy.DenyPatterns = appendUnique(policy.DenyPatterns, "*")
	}

	// Write the updated policy to disk
	if err := SavePolicy(m.policyPath, m.policy); err != nil {
		slog.Warn("failed to persist policy", "error", err, "tool", toolName, "decision", decision)
	}
}

// appendUnique appends an item to the slice only if it is not already present.
func appendUnique(slice []string, item string) []string {
	for _, s := range slice {
		if s == item {
			return slice
		}
	}
	return append(slice, item)
}

// buildParamPreview constructs a human-readable parameter preview string.
func buildParamPreview(params map[string]any) string {
	if len(params) == 0 {
		return ""
	}
	for k, v := range params {
		return fmt.Sprintf("%s: %v", k, v)
	}
	return ""
}
