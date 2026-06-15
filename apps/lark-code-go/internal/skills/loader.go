package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Skill represents an available skill (slash command) with prompt template and metadata.
type Skill struct {
	Name           string
	Description    string
	SystemPrompt   string
	AllowedTools   []string
	PromptTemplate string
}

// Loader loads and manages skills from multiple sources.
type Loader struct {
	builtinDir string
}

// NewLoader creates a new skill Loader.
func NewLoader() *Loader {
	return &Loader{
		builtinDir: "", // Resolved at lookup time
	}
}

// Resolve resolves a skill by name, searching with priority: project > user > built-in.
func (l *Loader) Resolve(name string, projectDir string) (*Skill, error) {
	// 1. Project-level .lark/skills/
	if projectDir != "" {
		if skill := l.loadFromDir(filepath.Join(projectDir, ".lark", "skills"), name); skill != nil {
			return skill, nil
		}
	}

	// 2. User-level ~/.lark/skills/
	homeDir, err := os.UserHomeDir()
	if err == nil {
		if skill := l.loadFromDir(filepath.Join(homeDir, ".lark", "skills"), name); skill != nil {
			return skill, nil
		}
	}

	// 3. Built-in skills
	if skill := l.loadBuiltin(name); skill != nil {
		return skill, nil
	}

	return nil, fmt.Errorf("skill not found: %s", name)
}

// ListAll returns all available skills.
func (l *Loader) ListAll() []*Skill {
	var skills []*Skill
	skills = append(skills, l.listBuiltin()...)
	return skills
}

// RenderPrompt renders the skill's prompt template, substituting $ARGUMENTS.
func (l *Loader) RenderPrompt(skill *Skill, arguments string) string {
	return strings.ReplaceAll(skill.PromptTemplate, "$ARGUMENTS", arguments)
}

// loadFromDir loads a skill from the specified directory.
func (l *Loader) loadFromDir(dir, name string) *Skill {
	path := filepath.Join(dir, name+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return parseSkillFile(name, string(data))
}

// loadBuiltin loads a built-in skill by name.
func (l *Loader) loadBuiltin(name string) *Skill {
	// Built-in skills are hardcoded
	builtins := map[string]string{
		"init":        builtinInit,
		"orchestrate": builtinOrchestrate,
		"review":      builtinReview,
		"summarize":   builtinSummarize,
	}

	content, ok := builtins[name]
	if !ok {
		return nil
	}
	return parseSkillFile(name, content)
}

// listBuiltin returns all built-in skills.
func (l *Loader) listBuiltin() []*Skill {
	names := []string{"init", "orchestrate", "review", "summarize"}
	var skills []*Skill
	for _, name := range names {
		if skill := l.loadBuiltin(name); skill != nil {
			skills = append(skills, skill)
		}
	}
	return skills
}

// parseSkillFile parses a skill file with optional YAML frontmatter and body content.
func parseSkillFile(name, content string) *Skill {
	skill := &Skill{
		Name:           name,
		PromptTemplate: content,
	}

	// Parse optional YAML frontmatter
	if strings.HasPrefix(content, "---") {
		parts := strings.SplitN(content[3:], "---", 2)
		if len(parts) == 2 {
			var fm struct {
				Description  string   `yaml:"description"`
				AllowedTools []string `yaml:"allowed_tools"`
				SystemPrompt string   `yaml:"system_prompt"`
			}
			if err := yaml.Unmarshal([]byte(parts[0]), &fm); err == nil {
				skill.Description = fm.Description
				skill.AllowedTools = fm.AllowedTools
				skill.SystemPrompt = fm.SystemPrompt
				skill.PromptTemplate = strings.TrimSpace(parts[1])
			}
		}
	}

	if skill.Description == "" {
		skill.Description = fmt.Sprintf("Run the %s skill", name)
	}

	return skill
}

// Built-in skill definitions
var builtinInit = `---
description: Analyze project structure and generate context.md
---
Analyze the project structure, identify the tech stack, key files, and coding patterns. Generate a comprehensive .lark/context.md file that helps future sessions understand this project.`

var builtinOrchestrate = `---
description: Plan, execute, and review a multi-step task
allowed_tools:
  - read_file
  - list_dir
  - bash
---
Break down the task into steps, execute each step, and review the results. $ARGUMENTS`

var builtinReview = `---
description: Review code changes with severity classification
allowed_tools:
  - read_file
  - bash
  - list_dir
---
Review the code changes. Classify findings by severity (critical, warning, info). For each finding, explain the issue and suggest a fix. $ARGUMENTS`

var builtinSummarize = `---
description: Compress session into a readable summary
---
Summarize this session's conversation into a clear, structured summary. Include key decisions, actions taken, and outcomes. $ARGUMENTS`
