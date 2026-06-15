package permissions

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// pendingEntry 追踪一个待审批请求的 session 和响应 channel
type pendingEntry struct {
	sessionID string
	ch        chan string
}

// Manager 管理工具调用的权限审批
type Manager struct {
	policy     *PolicyStore
	bus        *events.EventBus
	timeoutS   float64
	cwd        string
	policyPath string

	mu      sync.Mutex
	pending map[string]*pendingEntry // tool_use_id -> pendingEntry
	session map[string]Decision      // 会话级缓存
}

// NewManager 创建权限管理器
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

// CheckAndWait 检查权限并在需要时等待用户审批
func (m *Manager) CheckAndWait(
	toolName string,
	toolUseID string,
	params map[string]any,
	sessionID string,
	runID string,
) (Decision, error) {
	// 检查会话缓存
	cacheKey := toolName + ":" + fmt.Sprintf("%v", params)
	m.mu.Lock()
	if cached, ok := m.session[cacheKey]; ok {
		m.mu.Unlock()
		return cached, nil
	}
	m.mu.Unlock()

	// 评估策略
	decision := m.policy.Evaluate(toolName, params, m.cwd)

	switch decision {
	case DecisionAutoAllow:
		return DecisionAllowOnce, nil
	case DecisionAutoDeny:
		return DecisionDenyOnce, nil
	}

	// 需要用户审批
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

	// 发布权限请求事件
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

	// 等待响应或超时
	var timeoutCh <-chan time.Time
	if m.timeoutS > 0 {
		timeoutCh = time.After(time.Duration(m.timeoutS * float64(time.Second)))
	}

	select {
	case d := <-ch:
		decision := Decision(d)
		// 缓存 "always" 决策
		if decision == DecisionAlwaysAllow || decision == DecisionAlwaysDeny {
			m.mu.Lock()
			m.session[cacheKey] = decision
			m.mu.Unlock()
			// 持久化到 policy.toml
			m.persistAlwaysDecision(toolName, decision)
		}

		// 发布决策事件
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

// Respond 响应用户的权限决策
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

// CancelSession 取消指定 session 的所有待审批请求（按 sessionID 精确过滤）
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
			// channel 已满或已关闭
		}
	}
}

// persistAlwaysDecision 持久化 always 决策到 policy.toml
func (m *Manager) persistAlwaysDecision(toolName string, decision Decision) {
	if m.policyPath == "" {
		return
	}

	// 更新内存中的 policy
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

	// 写入文件
	if err := SavePolicy(m.policyPath, m.policy); err != nil {
		slog.Warn("failed to persist policy", "error", err, "tool", toolName, "decision", decision)
	}
}

// appendUnique 向切片追加不重复的元素
func appendUnique(slice []string, item string) []string {
	for _, s := range slice {
		if s == item {
			return slice
		}
	}
	return append(slice, item)
}

// buildParamPreview 构造参数预览字符串
func buildParamPreview(params map[string]any) string {
	if len(params) == 0 {
		return ""
	}
	for k, v := range params {
		return fmt.Sprintf("%s: %v", k, v)
	}
	return ""
}
