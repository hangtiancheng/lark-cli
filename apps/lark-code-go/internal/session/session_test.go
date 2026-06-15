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
	sess := session.NewSession("session-test-1", session.ModeChat, "Test Session")

	if err := store.WriteMeta(sess); err != nil {
		t.Fatalf("WriteMeta failed: %v", err)
	}

	loaded, err := store.ReadMeta("session-test-1")
	if err != nil {
		t.Fatalf("ReadMeta failed: %v", err)
	}

	if loaded.ID != "session-test-1" {
		t.Errorf("expected ID 'session-test-1', got %s", loaded.ID)
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
	sess := session.NewSession("session-msg", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	if err := store.AppendMessage("session-msg", "user", "hello", "run-1"); err != nil {
		t.Fatalf("AppendMessage failed: %v", err)
	}
	if err := store.AppendMessage("session-msg", "assistant", "hi there", "run-1"); err != nil {
		t.Fatalf("AppendMessage failed: %v", err)
	}

	messages, err := store.ReadMessages("session-msg")
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
	sess := session.NewSession("session-batch", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	messages := []map[string]any{
		{"role": "user", "content": "msg1"},
		{"role": "assistant", "content": "msg2"},
		{"role": "user", "content": "msg3"},
	}

	if err := store.AppendMessages("session-batch", messages, "run-1"); err != nil {
		t.Fatalf("AppendMessages failed: %v", err)
	}

	read, err := store.ReadMessages("session-batch")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}
	if len(read) != 3 {
		t.Errorf("expected 3 messages, got %d", len(read))
	}
}

func TestStoreReadNotes(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("session-notes", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// Initially no notes
	notes := store.ReadNotes("session-notes")
	if notes != "" {
		t.Errorf("expected empty notes, got %q", notes)
	}

	// Write notes
	notesPath := filepath.Join(store.SessionDir("session-notes"), "notes.md")
	_ = os.WriteFile(notesPath, []byte("# Notes\n- item 1"), 0o644)

	notes = store.ReadNotes("session-notes")
	if notes != "# Notes\n- item 1" {
		t.Errorf("unexpected notes content: %q", notes)
	}
}

func TestStoreWriteCompacted(t *testing.T) {
	store := newTestStore(t)
	sess := session.NewSession("session-compact", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// Write original messages
	_ = store.AppendMessage("session-compact", "user", "old msg 1", "run-1")
	_ = store.AppendMessage("session-compact", "assistant", "old reply 1", "run-1")

	// Compact
	compacted := []map[string]any{
		{"role": "user", "content": "[Previous conversation summarized]"},
		{"role": "assistant", "content": "Summary of old conversation"},
	}

	if err := store.WriteCompacted("session-compact", compacted); err != nil {
		t.Fatalf("WriteCompacted failed: %v", err)
	}

	// Verify compacted messages
	messages, err := store.ReadMessages("session-compact")
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
	sess := session.NewSession("session-orphan", session.ModeChat, "")
	_ = store.WriteMeta(sess)

	// Write normal message pair
	_ = store.AppendMessage("session-orphan", "user", "hello", "run-1")
	_ = store.AppendMessage("session-orphan", "assistant", "hi", "run-1")

	// Write orphaned tool_use (assistant message with tool_use but no subsequent tool_result)
	assistantWithToolUse := map[string]any{
		"role": "assistant",
		"content": []any{
			map[string]any{
				"type":  "tool_use",
				"id":    "tool-use-1",
				"name":  "bash",
				"input": map[string]any{"command": "ls"},
			},
		},
	}
	_ = store.AppendMessages("session-orphan", []map[string]any{assistantWithToolUse}, "run-1")

	messages, err := store.ReadMessages("session-orphan")
	if err != nil {
		t.Fatalf("ReadMessages failed: %v", err)
	}

	// Orphaned tool_use should be trimmed
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

	// Verify title auto-set
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

	// Send a long message
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

	// Consume the session.created event
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
	sess := session.NewSession("session-1", session.ModeChat, "Test")

	if sess.ID != "session-1" {
		t.Errorf("expected ID 'session-1', got %s", sess.ID)
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
