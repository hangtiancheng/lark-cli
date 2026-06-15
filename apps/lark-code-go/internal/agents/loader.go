package agents

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Profile 表示一个 agent 角色配置
type Profile struct {
	Name         string   `toml:"name"`
	Description  string   `toml:"description"`
	SystemPrompt string   `toml:"system_prompt"`
	AllowedTools []string `toml:"allowed_tools"`
	Model        string   `toml:"model"`
}

// LoadProfile 从 TOML 文件加载 agent profile
func LoadProfile(path string) (*Profile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read agent profile: %w", err)
	}

	var profile Profile
	if err := toml.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse agent profile: %w", err)
	}

	return &profile, nil
}

// LoadBuiltinProfile 加载内置 agent profile
func LoadBuiltinProfile(name string) (*Profile, error) {
	builtins := map[string]*Profile{
		"planner": {
			Name:         "planner",
			Description:  "Read-only analysis and task decomposition",
			SystemPrompt: "You are a planner. Analyze the task, break it down into steps, and create a detailed plan. Do not execute any changes - only read files and analyze.",
			AllowedTools: []string{"read_file", "list_dir", "bash"},
		},
		"executor": {
			Name:         "executor",
			Description:  "Follows plans and executes operations",
			SystemPrompt: "You are an executor. Follow the plan provided and execute each step carefully. Report progress and any issues encountered.",
			AllowedTools: []string{"read_file", "write_file", "bash", "list_dir"},
		},
		"reviewer": {
			Name:         "reviewer",
			Description:  "Read-only audit of execution results",
			SystemPrompt: "You are a reviewer. Audit the changes made by the executor. Check for correctness, completeness, and quality. Do not make any changes.",
			AllowedTools: []string{"read_file", "list_dir", "bash"},
		},
	}

	profile, ok := builtins[name]
	if !ok {
		return nil, fmt.Errorf("unknown agent profile: %s", name)
	}
	return profile, nil
}

// LoadFromDir 从目录加载所有 agent profiles
func LoadFromDir(dir string) ([]*Profile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var profiles []*Profile
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".toml" {
			continue
		}
		profile, err := LoadProfile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}
