package worktree

import (
	"strings"
	"testing"
)

func TestBuildWorktreeNotice(t *testing.T) {
	notice := BuildWorktreeNotice("/home/user/project", "/home/user/project/.larky/worktrees/agent-a1234567")

	// Must contain both paths
	if !strings.Contains(notice, "/home/user/project") {

		t.Fatal("notice should contain parent CWD")
	}
	if !strings.Contains(notice, "agent-a1234567") {
		t.Fatal("notice should contain worktree path")
	}
	// Must mention isolation concepts

	if !strings.Contains(notice, "isolated") {
		t.Fatal("notice should mention isolation")
	}
	if !strings.Contains(notice, "worktree") {
		t.Fatal("notice should mention worktree")
	}
	if !strings.Contains(notice, "Re-read") {
		t.Fatal("notice should tell agent to re-read files")
	}
}
