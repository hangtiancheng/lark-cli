package skills

import (
	"context"
	"errors"
	"strings"
	"testing"

	"larky/internal/conversation"
	"larky/internal/tools"
)

// stubHost captures every SkillHost call so tests can verify the executor
// fired the right side effects. Implements both SkillHost and SkillForkHost
// so the same fixture covers RunInline and RunFork.
type stubHost struct {
	activated     map[string]string
	filterAllow   func(string) bool
	registry      *tools.Registry
	parentMsgs    []conversation.Message
	subAgentBody  string
	subAgentSeed  []conversation.Message
	subAgentTools []string
	subAgentReply string
	subAgentErr   error
}

func newStubHost(reg *tools.Registry) *stubHost {
	return &stubHost{activated: map[string]string{}, registry: reg}
}

func (s *stubHost) ActivateSkill(name, body string)   { s.activated[name] = body }
func (s *stubHost) SetToolFilter(f func(string) bool) { s.filterAllow = f }
func (s *stubHost) ToolRegistry() *tools.Registry     { return s.registry }
func (s *stubHost) SnapshotParentMessages() []conversation.Message {
	out := make([]conversation.Message, len(s.parentMsgs))
	copy(out, s.parentMsgs)
	return out
}

func (s *stubHost) RunSubAgent(_ context.Context, body string, seed []conversation.Message, tools []string, _ string) (string, error) {
	s.subAgentBody = body
	s.subAgentSeed = seed
	s.subAgentTools = tools
	return s.subAgentReply, s.subAgentErr
}

func TestRunInlineActivatesAndFilters(t *testing.T) {
	reg := tools.NewRegistry()
	reg.Register(&tools.ReadFileTool{})
	reg.Register(&tools.BashTool{})

	host := newStubHost(reg)
	skill := &Skill{
		Meta: SkillMeta{
			Name:         "commit",
			Mode:         "inline",
			AllowedTools: []string{"ReadFile", "Bash"},
		},
		PromptBody: "Body with $ARGUMENTS",
		BodyLoaded: true,
	}

	body, err := RunInline(context.Background(), skill, "extra ctx", host)
	if err != nil {
		t.Fatalf("RunInline: %v", err)
	}
	if !strings.Contains(body, "extra ctx") {
		t.Errorf("body did not interpolate $ARGUMENTS: %q", body)
	}
	if host.activated["commit"] == "" {
		t.Errorf("ActivateSkill was not called")
	}
	if host.filterAllow == nil {
		t.Fatalf("SetToolFilter was not invoked")
	}
	if !host.filterAllow("ReadFile") || !host.filterAllow("Bash") {
		t.Errorf("filter must allow listed tools")
	}
	if host.filterAllow("Grep") {
		t.Errorf("filter must reject unlisted tools")
	}
}

func TestRunInlineFailsFastOnMissingTool(t *testing.T) {
	reg := tools.NewRegistry()
	host := newStubHost(reg)
	skill := &Skill{
		Meta:       SkillMeta{Name: "demo", AllowedTools: []string{"NonExistent"}},
		PromptBody: "body",
	}
	_, err := RunInline(context.Background(), skill, "", host)
	if err == nil {
		t.Fatal("expected fail-fast error for missing tool")
	}
	if !strings.Contains(err.Error(), "NonExistent") {
		t.Errorf("error should name the missing tool, got: %v", err)
	}
	if host.activated["demo"] != "" {
		t.Errorf("ActivateSkill must not fire when fail-fast trips")
	}
}

func TestRunForkPassesSeedAndAllowedTools(t *testing.T) {
	reg := tools.NewRegistry()
	reg.Register(&tools.BashTool{})

	host := newStubHost(reg)
	host.parentMsgs = []conversation.Message{
		{Role: "user", Content: "msg1"},
		{Role: "assistant", Content: "msg2"},
		{Role: "user", Content: "msg3"},
		{Role: "assistant", Content: "msg4"},
		{Role: "user", Content: "msg5"},
		{Role: "assistant", Content: "msg6"},
	}
	host.subAgentReply = "review complete"

	skill := &Skill{
		Meta: SkillMeta{
			Name:         "review",
			Mode:         "fork",
			ForkContext:  "recent",
			AllowedTools: []string{"Bash"},
		},
		PromptBody: "Review this: $ARGUMENTS",
	}

	out, err := RunFork(context.Background(), skill, "main.go", host)
	if err != nil {
		t.Fatalf("RunFork: %v", err)
	}
	if out != "review complete" {
		t.Errorf("unexpected fork output: %q", out)
	}
	if !strings.Contains(host.subAgentBody, "main.go") {
		t.Errorf("sub-agent body missing args: %q", host.subAgentBody)
	}
	if len(host.subAgentSeed) != 5 {
		t.Errorf("recent seed should be last 5; got %d", len(host.subAgentSeed))
	}
	if host.subAgentSeed[0].Content != "msg2" {
		t.Errorf("seed should start at msg2 (last-5 window), got %q", host.subAgentSeed[0].Content)
	}
	if len(host.subAgentTools) != 1 || host.subAgentTools[0] != "Bash" {
		t.Errorf("allowedTools not threaded through: %v", host.subAgentTools)
	}
}

func TestRunForkContextNone(t *testing.T) {
	reg := tools.NewRegistry()
	host := newStubHost(reg)
	host.parentMsgs = []conversation.Message{
		{Role: "user", Content: "should not leak"},
	}
	skill := &Skill{
		Meta:       SkillMeta{Name: "isolated", Mode: "fork", ForkContext: "none"},
		PromptBody: "Pure isolation.",
	}
	_, err := RunFork(context.Background(), skill, "", host)
	if err != nil {
		t.Fatalf("RunFork: %v", err)
	}
	if len(host.subAgentSeed) != 0 {
		t.Errorf("none mode must seed nothing; got %d msgs", len(host.subAgentSeed))
	}
}

func TestRunForkFailFastPropagatesAgentError(t *testing.T) {
	reg := tools.NewRegistry()
	reg.Register(&tools.BashTool{})
	host := newStubHost(reg)
	host.subAgentErr = errors.New("upstream failure")

	skill := &Skill{Meta: SkillMeta{Name: "review", Mode: "fork", AllowedTools: []string{"Bash"}}}
	_, err := RunFork(context.Background(), skill, "", host)
	if err == nil || !strings.Contains(err.Error(), "upstream") {
		t.Fatalf("expected upstream failure, got %v", err)
	}
}

func TestLoadSkillToolReturnsConfirmation(t *testing.T) {
	reg := tools.NewRegistry()
	cat := NewCatalog()
	cat.Register(&Skill{
		Meta:       SkillMeta{Name: "commit", Mode: "inline"},
		PromptBody: "do commit stuff",
		BodyLoaded: true,
	}, "builtin")

	host := newStubHost(reg)
	tool := &LoadSkillTool{Catalog: cat, Host: host}
	if !tool.IsSystemTool() {
		t.Fatal("LoadSkillTool must self-identify as system tool")
	}

	res := tool.Execute(context.Background(), map[string]any{"name": "commit"})
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Output)
	}
	if !strings.Contains(res.Output, "# Skill: commit") || !strings.Contains(res.Output, "do commit stuff") {
		t.Errorf("expected full SOP body in output: %q", res.Output)
	}
	if host.activated["commit"] == "" {
		t.Errorf("ActivateSkill not called")
	}
}

func TestLoadSkillToolUnknown(t *testing.T) {
	reg := tools.NewRegistry()
	cat := NewCatalog()
	host := newStubHost(reg)
	tool := &LoadSkillTool{Catalog: cat, Host: host}

	res := tool.Execute(context.Background(), map[string]any{"name": "missing"})
	if !res.IsError {
		t.Fatalf("expected error for missing skill")
	}
}
