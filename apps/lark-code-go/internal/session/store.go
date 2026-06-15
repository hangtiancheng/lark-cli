package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Store manages file-based session storage.
type Store struct {
	rootDir string
}

// NewStore creates a new session Store.
func NewStore(rootDir string) *Store {
	return &Store{rootDir: rootDir}
}

// SessionDir returns the directory path for the given session.
func (s *Store) SessionDir(sid string) string {
	return filepath.Join(s.rootDir, sid)
}

// RunsDir returns the runs directory for the given session.
func (s *Store) RunsDir(sid string) string {
	return filepath.Join(s.rootDir, sid, "runs")
}

// WriteMeta writes session metadata to disk.
func (s *Store) WriteMeta(sess *Session) error {
	dir := s.SessionDir(sess.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "meta.json"), data, 0o644)
}

// ReadMeta reads session metadata from disk.
func (s *Store) ReadMeta(sid string) (*Session, error) {
	data, err := os.ReadFile(filepath.Join(s.SessionDir(sid), "meta.json"))
	if err != nil {
		return nil, err
	}
	var sess Session
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, err
	}
	return &sess, nil
}

// AppendMessage appends a single message to the session's thread.jsonl file.
func (s *Store) AppendMessage(sid, role string, content any, runID string) error {
	dir := s.SessionDir(sid)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	entry := map[string]any{
		"role":    role,
		"content": content,
	}
	if runID != "" {
		entry["run_id"] = runID
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(filepath.Join(dir, "thread.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.Write(append(data, '\n'))
	return err
}

// AppendMessages appends multiple messages to the session's thread file.
func (s *Store) AppendMessages(sid string, messages []map[string]any, runID string) error {
	for _, msg := range messages {
		role, _ := msg["role"].(string)
		content := msg["content"]
		if err := s.AppendMessage(sid, role, content, runID); err != nil {
			return err
		}
	}
	return nil
}

// ReadMessages reads the complete conversation history from thread.jsonl.
func (s *Store) ReadMessages(sid string) ([]map[string]any, error) {
	path := filepath.Join(s.SessionDir(sid), "thread.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var messages []map[string]any
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}
		messages = append(messages, msg)
	}

	// Trim trailing orphaned tool_use blocks
	messages = trimOrphanToolUse(messages)

	return messages, nil
}

// ReadNotes reads the session notes file.
func (s *Store) ReadNotes(sid string) string {
	data, err := os.ReadFile(filepath.Join(s.SessionDir(sid), "notes.md"))
	if err != nil {
		return ""
	}
	return string(data)
}

// WriteCompacted writes a compacted conversation history, backing up the original.
func (s *Store) WriteCompacted(sid string, messages []map[string]any) error {
	dir := s.SessionDir(sid)

	// Back up the original file
	oldPath := filepath.Join(dir, "thread.jsonl")
	if _, err := os.Stat(oldPath); err == nil {
		backupPath := filepath.Join(dir, fmt.Sprintf("thread_%s.jsonl.bak",
			fmt.Sprintf("%d", os.Getpid())))
		_ = os.Rename(oldPath, backupPath)
	}

	// Write the new compacted file
	f, err := os.Create(oldPath)
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	for _, msg := range messages {
		if err := enc.Encode(msg); err != nil {
			return err
		}
	}
	return nil
}

// trimOrphanToolUse removes trailing assistant messages with tool_use blocks
// that have no corresponding tool_result.
func trimOrphanToolUse(messages []map[string]any) []map[string]any {
	if len(messages) == 0 {
		return messages
	}

	// Scan backwards from the tail to find the last assistant message.
	// If it contains tool_use without a subsequent tool_result, trim it.
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		role, _ := msg["role"].(string)
		if role != "assistant" {
			return messages[:i+1]
		}

		// Check if the content contains tool_use blocks
		content := msg["content"]
		if hasToolUse(content) {
			// Check if there is a corresponding tool_result following
			if i+1 < len(messages) {
				nextRole, _ := messages[i+1]["role"].(string)
				if nextRole == "user" && hasToolResult(messages[i+1]["content"]) {
					return messages[:i+2] // Pair is complete
				}
			}
			// Unpaired; trim this message and everything after it
			return messages[:i]
		}
		return messages[:i+1]
	}
	return messages
}

// hasToolUse checks whether the content contains tool_use blocks.
func hasToolUse(content any) bool {
	arr, ok := content.([]any)
	if !ok {
		return false
	}
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			if t, ok := m["type"].(string); ok && t == "tool_use" {
				return true
			}
		}
	}
	return false
}

// hasToolResult checks whether the content contains tool_result blocks.
func hasToolResult(content any) bool {
	arr, ok := content.([]any)
	if !ok {
		return false
	}
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			if t, ok := m["type"].(string); ok && t == "tool_result" {
				return true
			}
		}
	}
	return false
}
