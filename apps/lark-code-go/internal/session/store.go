package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Store 管理 session 的文件存储
type Store struct {
	rootDir string
}

// NewStore 创建 session 存储
func NewStore(rootDir string) *Store {
	return &Store{rootDir: rootDir}
}

// SessionDir 返回 session 目录
func (s *Store) SessionDir(sid string) string {
	return filepath.Join(s.rootDir, sid)
}

// RunsDir 返回 session 的 runs 目录
func (s *Store) RunsDir(sid string) string {
	return filepath.Join(s.rootDir, sid, "runs")
}

// WriteMeta 写入 session 元数据
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

// ReadMeta 读取 session 元数据
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

// AppendMessage 追加一条消息到 thread.jsonl
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

// AppendMessages 批量追加消息
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

// ReadMessages 读取完整的对话历史
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

	// 裁剪尾部未配对的 tool_use 块
	messages = trimOrphanToolUse(messages)

	return messages, nil
}

// ReadNotes 读取 session notes
func (s *Store) ReadNotes(sid string) string {
	data, err := os.ReadFile(filepath.Join(s.SessionDir(sid), "notes.md"))
	if err != nil {
		return ""
	}
	return string(data)
}

// WriteCompacted 写入压缩后的对话历史
func (s *Store) WriteCompacted(sid string, messages []map[string]any) error {
	dir := s.SessionDir(sid)

	// 备份原文件
	oldPath := filepath.Join(dir, "thread.jsonl")
	if _, err := os.Stat(oldPath); err == nil {
		backupPath := filepath.Join(dir, fmt.Sprintf("thread_%s.jsonl.bak",
			fmt.Sprintf("%d", os.Getpid())))
		_ = os.Rename(oldPath, backupPath)
	}

	// 写入新文件
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

// trimOrphanToolUse 裁剪尾部未配对的 assistant tool_use 消息
func trimOrphanToolUse(messages []map[string]any) []map[string]any {
	if len(messages) == 0 {
		return messages
	}

	// 从尾部向前扫描，找到最后一个 assistant 消息
	// 如果它包含 tool_use 但没有后续的 tool_result，则裁剪
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		role, _ := msg["role"].(string)
		if role != "assistant" {
			return messages[:i+1]
		}

		// 检查 content 是否包含 tool_use
		content := msg["content"]
		if hasToolUse(content) {
			// 检查后面是否有对应的 tool_result
			if i+1 < len(messages) {
				nextRole, _ := messages[i+1]["role"].(string)
				if nextRole == "user" && hasToolResult(messages[i+1]["content"]) {
					return messages[:i+2] // 配对完整
				}
			}
			// 未配对，裁剪此消息及之后
			return messages[:i]
		}
		return messages[:i+1]
	}
	return messages
}

// hasToolUse 检查内容是否包含 tool_use 块
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

// hasToolResult 检查内容是否包含 tool_result 块
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
