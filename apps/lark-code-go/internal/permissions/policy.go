package permissions

import (
	"path/filepath"
	"strings"
)

// Decision 表示权限决策
type Decision string

const (
	DecisionAllowOnce   Decision = "allow_once"
	DecisionAlwaysAllow Decision = "always_allow"
	DecisionAutoAllow   Decision = "auto_allow"
	DecisionDenyOnce    Decision = "deny_once"
	DecisionAlwaysDeny  Decision = "always_deny"
	DecisionAutoDeny    Decision = "auto_deny"
)

// ToolPolicy 定义工具的权限规则
type ToolPolicy struct {
	AllowPatterns []string `json:"allow_patterns" toml:"allow_patterns"`
	DenyPatterns  []string `json:"deny_patterns" toml:"deny_patterns"`
}

// PolicyStore 持久化的权限策略
type PolicyStore struct {
	Tools map[string]*ToolPolicy `json:"tools" toml:"tools"`
}

// Evaluate 评估工具调用的权限
// 优先级顺序：deny > OUTSIDE_CWD > allow > default
func (p *PolicyStore) Evaluate(toolName string, params map[string]any, cwd string) Decision {
	policy, ok := p.Tools[toolName]
	if !ok {
		return DecisionAllowOnce // 默认允许一次
	}

	// Tier 3 (最高): deny 模式 -- 强制拒绝
	for _, pattern := range policy.DenyPatterns {
		if matchParamPattern(pattern, params) {
			return DecisionAutoDeny
		}
	}

	// Tier 2: OUTSIDE_CWD -- 强制 ASK，覆盖 allow_patterns
	if isOutsideCWD(toolName, params, cwd) {
		return DecisionAllowOnce
	}

	// Tier 1: allow 模式 -- 自动允许
	for _, pattern := range policy.AllowPatterns {
		if matchParamPattern(pattern, params) {
			return DecisionAutoAllow
		}
	}

	// Tier 0 (默认): 需要询问
	return DecisionAllowOnce
}

// matchParamPattern 检查参数是否匹配 glob 模式
func matchParamPattern(pattern string, params map[string]any) bool {
	for _, v := range params {
		if s, ok := v.(string); ok {
			// 尝试 filepath.Match (glob)
			if matched, _ := filepath.Match(pattern, s); matched {
				return true
			}
			// 支持前缀匹配 (如 "rm *" 匹配 "rm -rf /")
			if len(pattern) >= 2 && pattern[len(pattern)-1] == '*' && pattern[len(pattern)-2] == ' ' {
				prefix := pattern[:len(pattern)-1] // "rm "
				if len(s) >= len(prefix) && s[:len(prefix)] == prefix {
					return true
				}
			}
			// 支持通配符匹配
			if pattern == "*" {
				return true
			}
		}
	}
	return false
}

// isOutsideCWD 检查工具操作是否在工作目录之外
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
