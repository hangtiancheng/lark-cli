package session

import "time"

// SessionMode 定义 session 模式
type SessionMode string

const (
	ModeOneShot SessionMode = "one_shot"
	ModeChat    SessionMode = "chat"
)

// SessionStatus 定义 session 状态
type SessionStatus string

const (
	StatusActive          SessionStatus = "active"
	StatusWaitingForInput SessionStatus = "waiting_for_input"
	StatusClosed          SessionStatus = "closed"
)

// Session 表示一个对话 session
type Session struct {
	ID        string        `json:"id"`
	Mode      SessionMode   `json:"mode"`
	Status    SessionStatus `json:"status"`
	Title     string        `json:"title"`
	CreatedAt string        `json:"created_at"`
	UpdatedAt string        `json:"updated_at"`
	RunIDs    []string      `json:"run_ids"`
}

// NewSession 创建新 session
func NewSession(id string, mode SessionMode, title string) *Session {
	now := time.Now().UTC().Format(time.RFC3339)
	return &Session{
		ID:        id,
		Mode:      mode,
		Status:    StatusActive,
		Title:     title,
		CreatedAt: now,
		UpdatedAt: now,
		RunIDs:    []string{},
	}
}
