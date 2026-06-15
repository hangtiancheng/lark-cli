package permissions_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/permissions"
)

func TestPolicyStoreEvaluateDefaultAllow(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	decision := store.Evaluate("unknown_tool", map[string]any{}, "/tmp")
	if decision != permissions.DecisionAllowOnce {
		t.Errorf("expected AllowOnce for unknown tool, got %s", decision)
	}
}

func TestPolicyStoreEvaluateDenyPattern(t *testing.T) {
	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"bash": {
				DenyPatterns: []string{"rm -rf /*"},
			},
		},
	}

	decision := store.Evaluate("bash", map[string]any{"command": "rm -rf /*"}, "/tmp")
	if decision != permissions.DecisionAutoDeny {
		t.Errorf("expected AutoDeny for deny pattern match, got %s", decision)
	}

	decision = store.Evaluate("bash", map[string]any{"command": "echo hello"}, "/tmp")
	if decision == permissions.DecisionAutoDeny {
		t.Error("expected non-deny for non-matching command")
	}
}

func TestPolicyStoreEvaluateAllowPattern(t *testing.T) {
	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"bash": {
				AllowPatterns: []string{"echo *"},
			},
		},
	}

	decision := store.Evaluate("bash", map[string]any{"command": "echo hello"}, "/tmp")
	if decision != permissions.DecisionAutoAllow {
		t.Errorf("expected AutoAllow for allow pattern match, got %s", decision)
	}
}

func TestPolicyStoreEvaluateOutsideCWD(t *testing.T) {
	// Verify OUTSIDE_CWD overrides allow_patterns:
	// Even when allow_patterns matches (would return AutoAllow),
	// if the path is outside CWD, it still returns AllowOnce (force ASK)

	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"read_file": {
				AllowPatterns: []string{"*"},
			},
		},
	}

	// Path inside CWD + allow_patterns matches -> AutoAllow
	decision := store.Evaluate("read_file", map[string]any{"path": "/tmp/test.txt"}, "/tmp")
	if decision != permissions.DecisionAutoAllow {
		t.Errorf("expected AutoAllow for inside CWD with allow_patterns, got %s", decision)
	}

	// Path outside CWD + allow_patterns matches -> AllowOnce (OUTSIDE_CWD overrides allow)
	decision = store.Evaluate("read_file", map[string]any{"path": "/etc/passwd"}, "/tmp")
	if decision != permissions.DecisionAllowOnce {
		t.Errorf("expected AllowOnce for outside CWD overriding allow_patterns, got %s", decision)
	}
}

func TestManagerCheckAndWaitAutoAllow(t *testing.T) {
	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"echo": {
				AllowPatterns: []string{"*"},
			},
		},
	}

	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 5.0, "/tmp", "")
	decision, err := mgr.CheckAndWait("echo", "tool-use-1", map[string]any{"msg": "hi"}, "session-1", "run-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision != permissions.DecisionAllowOnce {
		t.Errorf("expected AllowOnce, got %s", decision)
	}
}

func TestManagerCheckAndWaitAutoDeny(t *testing.T) {
	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"bash": {
				DenyPatterns: []string{"rm *"},
			},
		},
	}

	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 5.0, "/tmp", "")
	decision, err := mgr.CheckAndWait("bash", "tool-use-1", map[string]any{"command": "rm -rf /"}, "session-1", "run-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision != permissions.DecisionDenyOnce {
		t.Errorf("expected DenyOnce, got %s", decision)
	}
}

func TestManagerCheckAndWaitUserApproval(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}

	eb := events.NewEventBus()
	defer eb.Close()

	// Subscribe to permission request events
	ch := eb.Subscribe()

	mgr := permissions.NewManager(store, eb, 10.0, "/tmp", "")

	done := make(chan struct{})
	go func() {
		decision, err := mgr.CheckAndWait("bash", "tool-use-1", map[string]any{"command": "ls"}, "session-1", "run-1")
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if decision != permissions.DecisionAllowOnce {
			t.Errorf("expected AllowOnce, got %s", decision)
		}
		close(done)
	}()

	// Wait for the permission.requested event
	select {
	case evt := <-ch:
		if evt.EventType() != "permission.requested" {
			t.Errorf("expected permission.requested, got %s", evt.EventType())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for permission.requested event")
	}

	// Respond with allow
	ok := mgr.Respond("tool-use-1", "allow_once")
	if !ok {
		t.Error("Respond returned false")
	}

	<-done
}

func TestManagerCheckAndWaitTimeout(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}

	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 0.1, "/tmp", "") // 100ms timeout

	decision, err := mgr.CheckAndWait("bash", "tool-use-1", map[string]any{"command": "ls"}, "session-1", "run-1")
	if err == nil {
		t.Error("expected timeout error")
	}
	if decision != permissions.DecisionDenyOnce {
		t.Errorf("expected DenyOnce on timeout, got %s", decision)
	}
}

func TestManagerRespondNotFound(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 5.0, "/tmp", "")
	ok := mgr.Respond("nonexistent", "allow_once")
	if ok {
		t.Error("expected false for nonexistent tool_use_id")
	}
}

func TestManagerSessionCache(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 5.0, "/tmp", "")

	done := make(chan struct{})
	go func() {
		// First request: user selects always_allow
		_, err := mgr.CheckAndWait("bash", "tool-use-1", map[string]any{"command": "ls"}, "session-1", "run-1")
		if err != nil {
			t.Errorf("first call error: %v", err)
		}
		close(done)
	}()

	// Wait and respond with always_allow
	time.Sleep(50 * time.Millisecond)
	mgr.Respond("tool-use-1", "always_allow")
	<-done

	// Second request with same parameters should return from cache directly
	decision, err := mgr.CheckAndWait("bash", "tool-use-2", map[string]any{"command": "ls"}, "session-1", "run-1")
	if err != nil {
		t.Fatalf("cached call error: %v", err)
	}
	if decision != permissions.DecisionAlwaysAllow {
		t.Errorf("expected AlwaysAllow from cache, got %s", decision)
	}
}

func TestManagerCancelSession(t *testing.T) {
	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 30.0, "/tmp", "")

	// session-1's request
	sess1Done := make(chan struct{})
	go func() {
		decision, err := mgr.CheckAndWait("bash", "tool-use-s1", map[string]any{"command": "ls"}, "session-1", "run-1")
		if err == nil && decision != permissions.DecisionDenyOnce {
			t.Errorf("session-1: expected DenyOnce after cancel, got %s", decision)
		}
		close(sess1Done)
	}()

	// session-2's request
	sess2Done := make(chan struct{})
	sess2Decision := make(chan permissions.Decision, 1)
	go func() {
		decision, _ := mgr.CheckAndWait("bash", "tool-use-s2", map[string]any{"command": "ls"}, "session-2", "run-2")
		sess2Decision <- decision
		close(sess2Done)
	}()

	// Wait for both requests to arrive
	time.Sleep(100 * time.Millisecond)

	// Only cancel session-1
	mgr.CancelSession("session-1")
	<-sess1Done

	// session-2 should not be cancelled; respond to it
	time.Sleep(50 * time.Millisecond)
	ok := mgr.Respond("tool-use-s2", "allow_once")
	if !ok {
		t.Error("session-2 should still be pending after cancelling session-1")
	}
	<-sess2Done

	// Verify session-2 received allow_once
	select {
	case d := <-sess2Decision:
		if d != permissions.DecisionAllowOnce {
			t.Errorf("session-2: expected AllowOnce, got %s", d)
		}
	default:
		t.Error("session-2: no decision received")
	}
}

func TestManagerPersistAlwaysDecision(t *testing.T) {
	tmpDir := t.TempDir()
	policyPath := filepath.Join(tmpDir, "policy.toml")

	store := &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	eb := events.NewEventBus()
	defer eb.Close()

	mgr := permissions.NewManager(store, eb, 5.0, "/tmp", policyPath)

	done := make(chan struct{})
	go func() {
		mgr.CheckAndWait("bash", "tool-use-1", map[string]any{"command": "ls"}, "session-1", "run-1")
		close(done)
	}()

	time.Sleep(50 * time.Millisecond)
	mgr.Respond("tool-use-1", "always_allow")
	<-done

	// Verify the file was written
	loaded, err := permissions.LoadPolicy(policyPath)
	if err != nil {
		t.Fatalf("failed to load policy: %v", err)
	}

	policy, ok := loaded.Tools["bash"]
	if !ok {
		t.Fatal("expected bash policy to be persisted")
	}

	found := false
	for _, p := range policy.AllowPatterns {
		if p == "*" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected '*' in allow_patterns, got %v", policy.AllowPatterns)
	}
}

func TestLoadPolicyNonexistent(t *testing.T) {
	store, err := permissions.LoadPolicy("/nonexistent/path/policy.toml")
	if err != nil {
		t.Fatalf("expected no error for nonexistent file, got %v", err)
	}
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if len(store.Tools) != 0 {
		t.Errorf("expected empty tools map, got %d", len(store.Tools))
	}
}

func TestSaveAndLoadPolicy(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "policy.toml")

	store := &permissions.PolicyStore{
		Tools: map[string]*permissions.ToolPolicy{
			"bash": {
				AllowPatterns: []string{"echo *", "ls"},
				DenyPatterns:  []string{"rm -rf *"},
			},
		},
	}

	if err := permissions.SavePolicy(path, store); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	loaded, err := permissions.LoadPolicy(path)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}

	policy, ok := loaded.Tools["bash"]
	if !ok {
		t.Fatal("expected bash tool in loaded policy")
	}
	if len(policy.AllowPatterns) != 2 {
		t.Errorf("expected 2 allow patterns, got %d", len(policy.AllowPatterns))
	}
	if len(policy.DenyPatterns) != 1 {
		t.Errorf("expected 1 deny pattern, got %d", len(policy.DenyPatterns))
	}
}
