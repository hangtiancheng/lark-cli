package permissions

import (
	"path/filepath"
	"regexp"
	"strings"
)

// Decision represents a permission decision.
type Decision string

const (
	DecisionAllowOnce   Decision = "allow_once"
	DecisionAlwaysAllow Decision = "always_allow"
	DecisionAutoAllow   Decision = "auto_allow"
	DecisionDenyOnce    Decision = "deny_once"
	DecisionAlwaysDeny  Decision = "always_deny"
	DecisionAutoDeny    Decision = "auto_deny"
)

// DefaultToolDecisions maps tool names to their default permission decision
// when no explicit policy is configured. Tools not listed default to DecisionAllowOnce (ASK).
var DefaultToolDecisions = map[string]Decision{
	"bash":       DecisionAllowOnce, // ASK
	"write_file": DecisionAllowOnce, // ASK
	"read_file":  DecisionAutoAllow, // ALLOW
	"list_dir":   DecisionAutoAllow, // ALLOW
	"note_save":  DecisionAutoAllow, // ALLOW
}

// bashOutsideCwdPatterns detects bash commands that access paths outside the working directory.
var bashOutsideCwdPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(^|\s)/[^\s]`),             // absolute paths
	regexp.MustCompile(`(^|\s)~`),                  // tilde expansion
	regexp.MustCompile(`(^|\s)\.\.(/|$|\s)`),       // parent traversal
	regexp.MustCompile(`\$\{?HOME\b`),              // $HOME or ${HOME}
	regexp.MustCompile(`\$\{?PWD\b`),               // $PWD or ${PWD}
	regexp.MustCompile(`(^|\s|;|&&|\|\|)cd(\s|$)`), // cd command
}

// ToolPolicy defines permission rules for a tool.
type ToolPolicy struct {
	AllowPatterns []string `json:"allow_patterns" toml:"allow_patterns"`
	DenyPatterns  []string `json:"deny_patterns" toml:"deny_patterns"`
}

// PolicyStore holds persisted permission policies.
type PolicyStore struct {
	Tools map[string]*ToolPolicy `json:"tools" toml:"tools"`
}

// Evaluate assesses the permission for a tool invocation.
// Priority order: deny > OUTSIDE_CWD > allow > default.
func (p *PolicyStore) Evaluate(toolName string, params map[string]any, cwd string) Decision {
	policy, ok := p.Tools[toolName]

	// Determine the base decision: explicit policy or default
	baseDecision := DecisionAllowOnce // unknown tools require ASK
	if !ok {
		if d, found := DefaultToolDecisions[toolName]; found {
			baseDecision = d
		}
	}

	// Tier 3 (highest): deny mode - force deny
	if ok {
		for _, pattern := range policy.DenyPatterns {
			if matchParamPattern(pattern, params) {
				return DecisionAutoDeny
			}
		}
	}

	// Tier 2: OUTSIDE_CWD - force ASK, overrides allow_patterns
	if isOutsideCWD(toolName, params, cwd) {
		return DecisionAllowOnce
	}
	if toolName == "bash" && isBashOutsideCWD(params) {
		return DecisionAllowOnce
	}

	// Tier 1: allow mode - auto-allow
	if ok {
		for _, pattern := range policy.AllowPatterns {
			if matchParamPattern(pattern, params) {
				return DecisionAutoAllow
			}
		}
	}

	return baseDecision
}

// matchParamPattern checks if any parameter value matches the given glob pattern.
func matchParamPattern(pattern string, params map[string]any) bool {
	for _, v := range params {
		if s, ok := v.(string); ok {
			// Try filepath.Match (glob pattern)
			if matched, _ := filepath.Match(pattern, s); matched {
				return true
			}
			// Support prefix matching (e.g., 'rm *' matches 'rm -rf /')
			if len(pattern) >= 2 && pattern[len(pattern)-1] == '*' && pattern[len(pattern)-2] == ' ' {
				prefix := pattern[:len(pattern)-1] // "rm "
				if len(s) >= len(prefix) && s[:len(prefix)] == prefix {
					return true
				}
			}
			// Support wildcard matching
			if pattern == "*" {
				return true
			}
		}
	}
	return false
}

// isOutsideCWD checks whether a tool operation targets a path outside the working directory.
func isOutsideCWD(toolName string, params map[string]any, cwd string) bool {
	if cwd == "" {
		return false
	}

	pathKeys := []string{"path", "file", "directory"}
	for _, key := range pathKeys {
		if p, ok := params[key].(string); ok {
			resolved := p
			if !filepath.IsAbs(resolved) {
				resolved = filepath.Join(cwd, resolved)
			}
			resolved = filepath.Clean(resolved)
			rel, err := filepath.Rel(cwd, resolved)
			if err != nil || strings.HasPrefix(rel, "..") {
				return true
			}
		}
	}
	return false
}

// isBashOutsideCWD checks whether a bash command accesses paths outside the working directory
// using heuristic regex patterns (absolute paths, tilde, parent traversal, env vars, cd).
func isBashOutsideCWD(params map[string]any) bool {
	cmd, ok := params["command"].(string)
	if !ok {
		return false
	}
	for _, re := range bashOutsideCwdPatterns {
		if re.MatchString(cmd) {
			return true
		}
	}
	return false
}
