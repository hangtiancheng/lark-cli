package session

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
)

// RunFunc 执行 agent run 的回调函数类型
type RunFunc func(session *Session, goal string, systemPromptOverride string, toolWhitelist []string) (string, error)

// Manager 管理 session 生命周期
type Manager struct {
	store *Store
	bus   *events.EventBus
	runFn RunFunc

	mu       sync.Mutex
	sessions map[string]*Session
	locks    map[string]*sync.Mutex
}

// NewManager 创建 session 管理器
func NewManager(store *Store, busInst *events.EventBus, runFn RunFunc) *Manager {
	return &Manager{
		store:    store,
		bus:      busInst,
		runFn:    runFn,
		sessions: make(map[string]*Session),
		locks:    make(map[string]*sync.Mutex),
	}
}

// Create 创建新 session
func (m *Manager) Create(mode SessionMode, title string) (*Session, error) {
	id := fmt.Sprintf("session-%s", uuid.New().String()[:12])
	sess := NewSession(id, mode, title)

	if err := m.store.WriteMeta(sess); err != nil {
		return nil, fmt.Errorf("failed to write session meta: %w", err)
	}

	m.mu.Lock()
	m.sessions[id] = sess
	m.locks[id] = &sync.Mutex{}
	m.mu.Unlock()

	m.bus.Publish(&bus.SessionCreatedEvent{
		Type:      "session.created",
		SessionID: id,
		Mode:      string(mode),
		TS:        time.Now().UTC().Format(time.RFC3339),
	})

	return sess, nil
}

// SendMessage 发送消息到 session 并触发 agent run
func (m *Manager) SendMessage(sid, content string) (string, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sid]
	lock := m.locks[sid]
	m.mu.Unlock()

	if !ok {
		// 尝试从存储加载
		var err error
		sess, err = m.store.ReadMeta(sid)
		if err != nil {
			return "", fmt.Errorf("session not found: %s", sid)
		}
		m.mu.Lock()
		m.sessions[sid] = sess
		if m.locks[sid] == nil {
			m.locks[sid] = &sync.Mutex{}
		}
		lock = m.locks[sid]
		m.mu.Unlock()
	}

	// 防止并发 run
	if !lock.TryLock() {
		return "", fmt.Errorf("session %s is busy", sid)
	}
	defer lock.Unlock()

	if sess.Status == StatusClosed {
		return "", fmt.Errorf("session %s is closed", sid)
	}

	// 发布消息接收事件
	m.bus.Publish(&bus.SessionMessageReceivedEvent{
		Type:      "session.message_received",
		SessionID: sid,
		Content:   content,
		TS:        time.Now().UTC().Format(time.RFC3339),
	})

	// 从首条消息自动设置标题
	if sess.Title == "" && len(content) > 0 {
		title := content
		if len(title) > 40 {
			title = title[:40] + "..."
		}
		sess.Title = title
	}

	// 追加用户消息到 thread
	if err := m.store.AppendMessage(sid, "user", content, ""); err != nil {
		return "", fmt.Errorf("failed to append message: %w", err)
	}

	// 执行 agent run
	runID, err := m.runFn(sess, content, "", nil)
	if err != nil {
		return "", err
	}

	// 更新 session
	sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	sess.RunIDs = append(sess.RunIDs, runID)

	switch sess.Mode {
	case ModeOneShot:
		sess.Status = StatusClosed
		m.store.WriteMeta(sess)
		m.bus.Publish(&bus.SessionClosedEvent{
			Type:      "session.closed",
			SessionID: sid,
			TS:        time.Now().UTC().Format(time.RFC3339),
		})
	case ModeChat:
		sess.Status = StatusWaitingForInput
		m.store.WriteMeta(sess)
		m.bus.Publish(&bus.SessionWaitingForInputEvent{
			Type:      "session.waiting_for_input",
			SessionID: sid,
			LastRunID: runID,
			TS:        time.Now().UTC().Format(time.RFC3339),
		})
	}

	return runID, nil
}

// Close 关闭 session
func (m *Manager) Close(sid string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sid]
	m.mu.Unlock()

	if !ok {
		return fmt.Errorf("session not found: %s", sid)
	}

	sess.Status = StatusClosed
	sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := m.store.WriteMeta(sess); err != nil {
		return err
	}

	m.bus.Publish(&bus.SessionClosedEvent{
		Type:      "session.closed",
		SessionID: sid,
		TS:        time.Now().UTC().Format(time.RFC3339),
	})

	return nil
}

// GetHistory 获取 session 历史消息
func (m *Manager) GetHistory(sid string) ([]map[string]any, error) {
	return m.store.ReadMessages(sid)
}

// GetSession 获取 session 对象
func (m *Manager) GetSession(sid string) (*Session, error) {
	m.mu.Lock()
	sess, ok := m.sessions[sid]
	m.mu.Unlock()

	if ok {
		return sess, nil
	}

	sess, err := m.store.ReadMeta(sid)
	if err != nil {
		return nil, fmt.Errorf("session not found: %s", sid)
	}

	m.mu.Lock()
	m.sessions[sid] = sess
	if m.locks[sid] == nil {
		m.locks[sid] = &sync.Mutex{}
	}
	m.mu.Unlock()

	return sess, nil
}
