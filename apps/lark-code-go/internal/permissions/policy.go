package permissions

import (
	"path/filepath"
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
	if !ok {
		return DecisionAllowOnce // Default: allow once (requires user confirmation)
	}

	// Tier 3 (highest): deny mode - force deny
	for _, pattern := range policy.DenyPatterns {
		if matchParamPattern(pattern, params) {
			return DecisionAutoDeny
		}
	}

	// Tier 2: OUTSIDE_CWD - force ASK, overrides allow_patterns
	if isOutsideCWD(toolName, params, cwd) {
		return DecisionAllowOnce
	}

	// Tier 1: allow mode - auto-allow
	for _, pattern := range policy.AllowPatterns {
		if matchParamPattern(pattern, params) {
			return DecisionAutoAllow
		}
	}

	// Tier 0 (default): requires user confirmation
	return DecisionAllowOnce
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
