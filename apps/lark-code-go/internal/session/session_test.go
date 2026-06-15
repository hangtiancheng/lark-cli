package session_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/session"
)

func newTestStore(t *testing.T) *session.Store {
	t.Helper()
	dir := t.TempDir()
	return session.NewStore(dir)
}

func TestStoreWriteAndReadMeta(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-test-1", session.ModeChat, "Test Session")

	if err := store.WriteMeta(sess); err != nil {
		t.Fatalf("WriteMeta failed: %v", err)
	}

	loaded, err := store.ReadMeta("sess-test-1")
	if err != nil {
		t.Fatalf("ReadMeta failed: %v", err)
	}

	if loaded.ID != "sess-test-1" {
		t.Errorf("expected ID 'sess-test-1', got %s", loaded.ID)
	}
	if loaded.Mode != session.ModeChat {
		t.Errorf("expected mode chat, got %s", loaded.Mode)
	}
	if loaded.Title != "Test Session" {
		t.Errorf("expected title 'Test Session', got %s", loaded.Title)
	}
	if loaded.Status != session.StatusActive {
		t.Errorf("expected status active, got %s", loaded.Status)
	}
}

func TestStoreAppendAndReadMessages(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-msg", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	if err := store.AppendMessage("sess-msg", "user", "hello", "run-1"); err != nil {
		t.Fatalf("AppendMessage failed: %v", err)
	}
	if err := store.AppendMessage("sess-msg", "assistant", "hi there", "run-1"); err != nil {
		t.Fatalf("AppendMessage failed: %v", err)
	}

	messages, err := store.ReadMessages("sess-msg")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0]["role"] != "user" {
		t.Errorf("expected first message role 'user', got %v", messages[0]["role"])
	}
	if messages[1]["role"] != "assistant" {
		t.Errorf("expected second message role 'assistant', got %v", messages[1]["role"])
	}
}

func TestStoreAppendMessages(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-batch", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	messages := []map[string]any{
		{"role": "user", "content": "msg1"},
		{"role": "assistant", "content": "msg2"},
		{"role": "user", "content": "msg3"},
	}

	if err := store.AppendMessages("sess-batch", messages, "run-1"); err != nil {
		t.Fatalf("AppendMessages failed: %v", err)
	}

	read, err := store.ReadMessages("sess-batch")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}
	if len(read) != 3 {
		t.Errorf("expected 3 messages, got %d", len(read))
	}
}

func TestStoreReadNotes(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-notes", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// 初始无 notes
	notes := store.ReadNotes("sess-notes")
	if notes != "" {
		t.Errorf("expected empty notes, got %q", notes)
	}

	// 写入 notes
	notesPath := filepath.Join(store.SessionDir("sess-notes"), "notes.md")
	_ = os.WriteFile(notesPath, []byte("# Notes\n- item 1"), 0o644)

	notes = store.ReadNotes("sess-notes")
	if notes != "# Notes\n- item 1" {
		t.Errorf("unexpected notes content: %q", notes)
	}
}

func TestStoreWriteCompacted(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-compact", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// 写入原始消息
	_ = store.AppendMessage("sess-compact", "user", "old msg 1", "run-1")
	_ = store.AppendMessage("sess-compact", "assistant", "old reply 1", "run-1")

	// 压缩
	compacted := []map[string]any{
		{"role": "user", "content": "[Previous conversation summarized]"},
		{"role": "assistant", "content": "Summary of old conversation"},
	}

	if err := store.WriteCompacted("sess-compact", compacted); err != nil {
		t.Fatalf("WriteCompacted failed: %v", err)
	}

	// 验证压缩后的消息
	messages, err := store.ReadMessages("sess-compact")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 compacted messages, got %d", len(messages))
	}
	if messages[0]["content"] != "[Previous conversation summarized]" {
		t.Errorf("unexpected first message: %v", messages[0]["content"])
	}
}

func TestStoreTrimOrphanToolUse(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("sess-orphan", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// 写入正常消息对
	_ = store.AppendMessage("sess-orphan", "user", "hello", "run-1")
	_ = store.AppendMessage("sess-orphan", "assistant", "hi", "run-1")

	// 写入孤立的 tool_use（assistant 消息包含 tool_use 但没有后续 tool_result）
	assistantWithToolUse := map[string]any{
		"role": "assistant",
		"content": []any{
			map[string]any{
				"type":  "tool_use",
				"id":    "tu-1",
				"name":  "bash",
				"input": map[string]any{"command": "ls"},
			},
		},
	}
	_ = store.AppendMessages("sess-orphan", []map[string]any{assistantWithToolUse}, "run-1")

	messages, err := store.ReadMessages("sess-orphan")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}

	// 孤立的 tool_use 应该被裁剪
	if len(messages) != 2 {
		t.Errorf("expected 2 messages after trimming orphan, got %d", len(messages))
	}
}

func TestManagerCreate(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-mock", nil
	})

	sess, err := mgr.Create(session.ModeChat, "Test")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if sess.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if sess.Mode != session.ModeChat {
		t.Errorf("expected mode chat, got %s", sess.Mode)
	}
	if sess.Title != "Test" {
		t.Errorf("expected title 'Test', got %s", sess.Title)
	}
}

func TestManagerSendMessage(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	runCalled := false
	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		runCalled = true
		if goal != "hello world" {
			t.Errorf("expected goal 'hello world', got %q", goal)
		}
		return "run-123", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")

	runID, err := mgr.SendMessage(sess.ID, "hello world")
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}
	if !runCalled {
		t.Error("run function was not called")
	}
	if runID != "run-123" {
		t.Errorf("expected run ID 'run-123', got %s", runID)
	}

	// 验证标题自动设置
	updated, _ := mgr.GetSession(sess.ID)
	if updated.Title == "" {
		t.Error("expected auto-set title from first message")
	}
}

func TestManagerSendMessageAutoTitle(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")

	// 发送长消息
	longMsg := "This is a very long message that should be truncated when used as the session title because it exceeds the maximum length"
	_, _ = mgr.SendMessage(sess.ID, longMsg)

	updated, _ := mgr.GetSession(sess.ID)
	if len(updated.Title) > 50 {
		t.Errorf("title should be truncated, got length %d", len(updated.Title))
	}
}

func TestManagerSendMessageClosedSession(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")
	_ = mgr.Close(sess.ID)

	_, err := mgr.SendMessage(sess.ID, "hello")
	if err == nil {
		t.Error("expected error when sending to closed session")
	}
}

func TestManagerClose(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")
	if err := mgr.Close(sess.ID); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	loaded, _ := mgr.GetSession(sess.ID)
	if loaded.Status != session.StatusClosed {
		t.Errorf("expected status closed, got %s", loaded.Status)
	}
}

func TestManagerCloseNonexistent(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	err := mgr.Close("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestManagerGetHistory(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")
	_ = store.AppendMessage(sess.ID, "user", "hello", "run-1")
	_ = store.AppendMessage(sess.ID, "assistant", "hi", "run-1")

	history, err := mgr.GetHistory(sess.ID)
	if err != nil {
		t.Fatalf("GetHistory failed: %v", err)
	}
	if len(history) != 2 {
		t.Errorf("expected 2 history messages, got %d", len(history))
	}
}

func TestManagerOneShotModeAutoClose(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeOneShot, "")
	_, _ = mgr.SendMessage(sess.ID, "do something")

	loaded, _ := mgr.GetSession(sess.ID)
	if loaded.Status != session.StatusClosed {
		t.Errorf("expected OneShot session to be closed after run, got %s", loaded.Status)
	}
}

func TestManagerEventPublishing(t *testing.T) {
	store := newTestStore(t)
	eb := events.NewEventBus()
	defer eb.Close()

	ch := eb.Subscribe()

	mgr := session.NewManager(store, eb, func(s *session.Session, goal, override string, whitelist []string) (string, error) {
		return "run-1", nil
	})

	sess, _ := mgr.Create(session.ModeChat, "")

	// 消费 session.created 事件
	select {
	case evt := <-ch:
		if evt.EventType() != "session.created" {
			t.Errorf("expected session.created, got %s", evt.EventType())
		}
	default:
	}

	_ = sess
}

func TestNewSession(t *testing.T) {
	sess := session.NewSession("sess-1", session.ModeChat, "Test")

	if sess.ID != "sess-1" {
		t.Errorf("expected ID 'sess-1', got %s", sess.ID)
	}
	if sess.Mode != session.ModeChat {
		t.Errorf("expected mode chat, got %s", sess.Mode)
	}
	if sess.Status != session.StatusActive {
		t.Errorf("expected status active, got %s", sess.Status)
	}
	if sess.CreatedAt == "" {
		t.Error("expected non-empty CreatedAt")
	}
	if sess.RunIDs == nil {
		t.Error("expected non-nil RunIDs")
	}
}
