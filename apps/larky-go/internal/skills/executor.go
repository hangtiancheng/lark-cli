package skills

import (
	"context"
	"fmt"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/conversation"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/tools"
)

// SkillHost is the slice of Agent state that the Executor needs to drive
// inline-mode skills. Implemented by *agent.Agent; declared as an interface
// here so the skills package doesn't import the agent package (would create
// a cycle once LoadSkillTool starts referencing skills.Catalog).
type SkillHost interface {
	// ActivateSkill records the skill activation for tracking (/skills listing
	// and compaction recovery). The body is NOT re-injected every turn.
	ActivateSkill(name, body string)
	// SetToolFilter installs the per-skill allowed_tools whitelist. Passing
	// nil clears any prior filter (skill done, restore default visibility).
	SetToolFilter(allow func(name string) bool)
	// ToolRegistry exposes the live tools.Registry so the executor can do
	// fail-fast dependency checks and register directory-type tools. Named
	// ToolRegistry (not Registry) because *agent.Agent already has an
	// exported Registry field and Go forbids method/field name collision.
	ToolRegistry() *tools.Registry
}

// SkillForkHost extends SkillHost with the ability to run an isolated
// sub-agent. Implemented by the TUI layer (which owns the LLM client +
// agent constructor) and passed into Executor.RunFork. Keeping it separate
// from SkillHost lets unit tests stub fork-only behaviour without faking
// the full sub-agent runtime.
type SkillForkHost interface {
	SkillHost
	// RunSubAgent runs `body` as the first user message in a fresh
	// conversation seeded with `seed` (already prepared per ForkContext
	// strategy), restricted to allowedTools, and returns the final
	// assistant text. ctx cancellation should abort the sub-agent.
	RunSubAgent(ctx context.Context, body string, seed []conversation.Message, allowedTools []string, model string) (string, error)
	// SnapshotParentMessages exposes the parent conversation messages so
	// the executor can build the seed per `fork_context`. Implementations
	// may return a shallow copy; the executor must not mutate the slice.
	SnapshotParentMessages() []conversation.Message
}

// RunInline records the skill activation on the host agent, applies the
// allowed_tools whitelist, and returns the rendered prompt body. The caller
// (a slash-command handler) submits the returned body as a user message in
// the main conversation — it lives there as a regular message, not
// re-injected every turn.
//
// Fail-fast: if allowed_tools names a tool that's not in the registry,
// returns an error and does *not* activate the skill or install the
// filter. Better to surface a missing dependency at invocation time
// than to let the model discover it halfway through a multi-step plan.
func RunInline(_ context.Context, skill *Skill, args string, host SkillHost) (string, error) {
	if err := assertAllowedToolsExist(skill, host.ToolRegistry()); err != nil {
		return "", err
	}
	body := skill.renderBody(args)
	host.ActivateSkill(skill.Meta.Name, body)
	if len(skill.Meta.AllowedTools) > 0 {
		allowed := skillToolAllowSet(skill)
		host.SetToolFilter(func(name string) bool { return allowed[name] })
	} else {
		host.SetToolFilter(nil)
	}
	return body, nil
}

// RunFork executes the skill in an isolated sub-agent and returns the
// final assistant text. The main conversation is not modified by the
// sub-agent; the caller (slash-command handler) is expected to insert
// the returned string into the main chat history as an assistant message.
//
// History carry-over is selected by skill.Meta.ForkContext:
//   - "full":  seed the sub-agent with the parent's full message history
//   - "recent": seed with the last 5 parent messages
//   - "none":  no seed (default; isolated like a fresh session)
//
// Fail-fast on allowed_tools just like RunInline.
func RunFork(ctx context.Context, skill *Skill, args string, host SkillForkHost) (string, error) {
	if err := assertAllowedToolsExist(skill, host.ToolRegistry()); err != nil {
		return "", err
	}
	body := skill.renderBody(args)
	seed := buildForkSeed(skill.Meta.ForkContext, host.SnapshotParentMessages())
	return host.RunSubAgent(ctx, body, seed, skill.Meta.AllowedTools, skill.Meta.Model)
}

// assertAllowedToolsExist checks every name in skill.Meta.AllowedTools is
// present in the registry. The catalog can declare tools that ship from
// directory-type skills (e.g. parse_resume) — those get registered by
// LoadSkillTool *before* this check fires, so it's safe to assume the
// registry is already hydrated by the time RunInline / RunFork runs.
func assertAllowedToolsExist(skill *Skill, reg *tools.Registry) error {
	for _, name := range skill.Meta.AllowedTools {
		if reg.Get(name) == nil {
			return fmt.Errorf("skill %q declares allowed tool %q which is not registered", skill.Meta.Name, name)
		}
	}
	return nil
}

// skillToolAllowSet builds a name → true map from the skill's AllowedTools.
// Used as the closure body of the SetToolFilter predicate. Returning a
// closure (instead of a slice + linear scan) keeps the per-iteration
// filter cost O(1) since it runs once per tool per iteration.
func skillToolAllowSet(skill *Skill) map[string]bool {
	out := make(map[string]bool, len(skill.Meta.AllowedTools))
	for _, name := range skill.Meta.AllowedTools {
		out[name] = true
	}
	return out
}

// buildForkSeed slices the parent message history according to the
// ForkContext strategy. Returns nil for "none" or unknown values so the
// sub-agent starts fresh.
//
// "full" currently performs no LLM-side summarisation — it copies the
// parent slice verbatim. A future refinement could route through
// compact.Summarise if context windows become a concern; for now keeping
// it identical to "recent" with a higher cap is sufficient.
func buildForkSeed(mode string, parent []conversation.Message) []conversation.Message {
	switch mode {
	case "full":
		out := make([]conversation.Message, len(parent))
		copy(out, parent)
		return out
	case "recent":
		if len(parent) <= 5 {
			out := make([]conversation.Message, len(parent))
			copy(out, parent)
			return out
		}
		out := make([]conversation.Message, 5)
		copy(out, parent[len(parent)-5:])
		return out
	default:
		return nil
	}
}
