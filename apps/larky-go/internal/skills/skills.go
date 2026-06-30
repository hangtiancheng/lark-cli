package skills

import (
	"strings"
)

type SkillMeta struct {
	Name         string   `yaml:"name"`
	Description  string   `yaml:"description"`
	WhenToUse    string   `yaml:"when_to_use"`
	Tags         []string `yaml:"tags"`
	AllowedTools []string `yaml:"allowed_tools"`
	// Mode selects the execution mode. "inline" (default) injects the skill body into the current
	// conversation; "fork" runs the skill body in a sub-agent with isolated context.
	Mode string `yaml:"mode"`
	// Model overrides the LLM used for this skill. Empty = inherit main loop.
	Model string `yaml:"model"`
	// Context is kept for backward compatibility with old skills that used `context: fork` to mean
	// Mode=fork. Treated as fork mode if value == "fork".
	Context string `yaml:"context"`
	// ForkContext controls how much of the parent conversation gets carried into the forked sub-agent.
	// Only meaningful when Mode == "fork". Values: "full" (LLM summary of parent), "recent" (last 5
	// messages), "none" (no parent context, default).
	ForkContext string `yaml:"fork_context"`
}

// IsFork reports whether the skill should run in fork mode. Checks both Mode and the legacy Context
// field for backward compatibility.
func (m SkillMeta) IsFork() bool {
	return m.Mode == "fork" || m.Context == "fork"
}

type Skill struct {
	Meta       SkillMeta
	PromptBody string
	SourceDir  string
	// IsDirectory marks skills whose SourceDir contains additional resources (tool.json, references/).
	// Single-file SKILL.md skills have IsDirectory true as well — the term refers to skills with
	// auxiliary tool.json, not to disk layout. False only for embedded skills that have no real
	// directory on disk to access at runtime.
	IsDirectory bool
	// BodyLoaded marks whether PromptBody has been read from disk. Phase-1 loading only reads
	// frontmatter; the body stays empty until GetFull triggers a read.
	BodyLoaded bool
}

// Render returns the skill body with $ARGUMENTS substituted. If the body has no $ARGUMENTS
// placeholder and args is non-empty, the args are appended in a "## User Request" section.
//
// For fork-context skills, Render returns a fork directive that instructs the main agent to
// delegate the skill body to a sub-agent via the Agent tool, restricted to the skill's
// AllowedTools.
func (s *Skill) Render(args string) string {
	body := s.renderBody(args)
	if s.Meta.IsFork() {
		return s.renderForkDirective(body)
	}
	return body
}

func (s *Skill) renderBody(args string) string {
	body := s.PromptBody
	if strings.Contains(body, "$ARGUMENTS") {
		return strings.ReplaceAll(body, "$ARGUMENTS", args)
	}
	if strings.TrimSpace(args) == "" {
		return body
	}
	return body + "\n\n## User Request\n\n" + args
}

// renderForkDirective wraps the skill body in instructions that tell the main agent to run it
// inside a forked sub-agent. The body itself stays out of the main agent's context until/unless the
// sub-agent's summary brings pieces back — that's the "progressive disclosure" property.
func (s *Skill) renderForkDirective(body string) string {
	var sb strings.Builder
	sb.WriteString("Run the skill `")
	sb.WriteString(s.Meta.Name)
	sb.WriteString("` in a forked sub-agent by calling the Agent tool with:\n")
	sb.WriteString("- subagent_type: general-purpose (or another agent if more appropriate)\n")
	if len(s.Meta.AllowedTools) > 0 {
		sb.WriteString("- restrict the sub-agent to these tools: ")
		sb.WriteString(strings.Join(s.Meta.AllowedTools, ", "))
		sb.WriteString("\n")
	}
	sb.WriteString("- prompt (pass verbatim to the sub-agent):\n\n")
	sb.WriteString(body)
	sb.WriteString("\n\nReport back only the sub-agent's final summary; do not perform the skill's steps yourself.")
	return sb.String()
}
