package session

import "time"

// SessionMode defines the operating mode for a session.
type SessionMode string

const (
	ModeOneShot SessionMode = "one_shot"
	ModeChat    SessionMode = "chat"
)

// SessionStatus defines the lifecycle state of a session.
type SessionStatus string

const (
	StatusActive          SessionStatus = "active"
	StatusWaitingForInput SessionStatus = "waiting_for_input"
	StatusClosed          SessionStatus = "closed"
)

// Session represents a conversation session with mode, status, and metadata.
type Session struct {
	ID        string        `json:"id"`
	Mode      SessionMode   `json:"mode"`
	Status    SessionStatus `json:"status"`
	Title     string        `json:"title"`
	CreatedAt string        `json:"created_at"`
	UpdatedAt string        `json:"updated_at"`
	RunIDs    []string      `json:"run_ids"`
}

// NewSession creates a new Session with the given parameters.
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
