package teams

import (
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"time"
)

type FileMailBox struct {
	baseDir string
}

type FileMailMessage struct {
	From      string `json:"from"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
	Read      bool   `json:"read"`
	Color     string `json:"color,omitempty"`
	Summary   string `json:"summary,omitempty"`
}

func NewFileMailBox(baseDir string) *FileMailBox {
	os.MkdirAll(baseDir, 0755)
	return &FileMailBox{baseDir: baseDir}
}

func (mb *FileMailBox) inboxPath(agentID string) string {
	return filepath.Join(mb.baseDir, agentID+".json")
}

func (mb *FileMailBox) lockPath(agentID string) string {
	return filepath.Join(mb.baseDir, agentID+".json.lock")
}

func (mb *FileMailBox) Send(recipient string, msg FileMailMessage) error {
	return mb.withLock(recipient, func(messages []FileMailMessage) ([]FileMailMessage, error) {
		msg.Read = false
		if msg.Timestamp == "" {
			msg.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
		}
		return append(messages, msg), nil
	})
}

func (mb *FileMailBox) ReadUnread(agentID string) ([]FileMailMessage, error) {
	messages, err := mb.readInbox(agentID)
	if err != nil {
		return nil, err
	}
	var unread []FileMailMessage
	for _, m := range messages {
		if !m.Read {
			unread = append(unread, m)
		}
	}
	return unread, nil
}

func (mb *FileMailBox) MarkAllRead(agentID string) error {
	return mb.withLock(agentID, func(messages []FileMailMessage) ([]FileMailMessage, error) {
		for i := range messages {
			messages[i].Read = true
		}
		return messages, nil
	})
}

// withLock acquires a file lock, reads the inbox, applies the mutation, and writes back.
func (mb *FileMailBox) withLock(agentID string, fn func([]FileMailMessage) ([]FileMailMessage, error)) error {
	lockFile := mb.lockPath(agentID)

	// Acquire lock with retries
	var lockFd *os.File
	var err error
	for attempt := 0; attempt < 10; attempt++ {
		lockFd, err = os.OpenFile(lockFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			return err
		}
		// Lock exists, check if stale (>10s old)
		if info, statErr := os.Stat(lockFile); statErr == nil {
			if time.Since(info.ModTime()) > 10*time.Second {
				os.Remove(lockFile)
			}
		}
		sleepMs := 5 + rand.Intn(96) // 5-100ms
		time.Sleep(time.Duration(sleepMs) * time.Millisecond)
	}
	if lockFd == nil {
		return err
	}
	lockFd.Close()
	defer os.Remove(lockFile)

	// Re-read inbox after acquiring lock
	messages, _ := mb.readInbox(agentID)

	// Apply mutation
	messages, err = fn(messages)
	if err != nil {
		return err
	}

	// Write back
	return mb.writeInbox(agentID, messages)
}

func (mb *FileMailBox) readInbox(agentID string) ([]FileMailMessage, error) {
	path := mb.inboxPath(agentID)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var messages []FileMailMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return nil, nil
	}
	return messages, nil
}

func (mb *FileMailBox) writeInbox(agentID string, messages []FileMailMessage) error {
	path := mb.inboxPath(agentID)
	data, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
