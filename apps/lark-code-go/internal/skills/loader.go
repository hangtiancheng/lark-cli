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

// ListAll returns all available skills (built-in only, for backward compatibility).
// Use ListAllWithDir to include project and user-level skills.
func (l *Loader) ListAll() []*Skill {
	return l.ListAllWithDir("")
}

// ListAllWithDir returns all available skills, scanning project, user, and built-in
// directories in priority order (project > user > built-in). Deduplicates by name,
// with higher-priority sources overriding lower ones.
// Scans both flat files (<name>.md) and directory-style (<name>/SKILL.md) layouts.
func (l *Loader) ListAllWithDir(projectDir string) []*Skill {
	seen := make(map[string]*Skill)

	// Build the search directory list in increasing priority so later entries override.
	var dirs []string

	// 1. Built-in skills (lowest priority)
	dirs = append(dirs, "") // builtin placeholder; handled below

	// 2. User-level ~/.lark/skills/
	if homeDir, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(homeDir, ".lark", "skills"))
	}

	// 3. Project-level .lark/skills/ (highest priority)
	if projectDir != "" {
		dirs = append(dirs, filepath.Join(projectDir, ".lark", "skills"))
	}

	for _, dir := range dirs {
		if dir == "" {
			// Built-in skills
			for _, s := range l.listBuiltin() {
				seen[s.Name] = s
			}
			continue
		}
		l.scanDir(dir, seen)
	}

	result := make([]*Skill, 0, len(seen))
	for _, s := range seen {
		result = append(result, s)
	}
	return result
}

// scanDir scans a directory for skill files and merges them into seen.
func (l *Loader) scanDir(dir string, seen map[string]*Skill) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			// Directory-style skill: <name>/SKILL.md
			skillPath := filepath.Join(dir, entry.Name(), "SKILL.md")
			if data, err := os.ReadFile(skillPath); err == nil {
				if s := parseSkillFile(entry.Name(), string(data)); s != nil {
					seen[s.Name] = s
				}
			}
			continue
		}
		// Flat file skill: <name>.md
		name := entry.Name()
		if !strings.HasSuffix(name, ".md") {
			continue
		}
		skillName := strings.TrimSuffix(name, ".md")
		path := filepath.Join(dir, name)
		if data, err := os.ReadFile(path); err == nil {
			if s := parseSkillFile(skillName, string(data)); s != nil {
				seen[s.Name] = s
			}
		}
	}
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
