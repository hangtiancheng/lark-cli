package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Skill 表示一个可用的 skill（斜杠命令）
type Skill struct {
	Name           string
	Description    string
	SystemPrompt   string
	AllowedTools   []string
	PromptTemplate string
}

// Loader 加载和管理 skills
type Loader struct {
	builtinDir string
}

// NewLoader 创建 skill 加载器
func NewLoader() *Loader {
	return &Loader{
		builtinDir: "", // 将在 Resolve 时查找
	}
}

// Resolve 解析 skill 名称，按优先级搜索：项目 > 用户 > 内置
func (l *Loader) Resolve(name string, projectDir string) (*Skill, error) {
	// 1. 项目级 .lark/skills/
	if projectDir != "" {
		if skill := l.loadFromDir(filepath.Join(projectDir, ".lark", "skills"), name); skill != nil {
			return skill, nil
		}
	}

	// 2. 用户级 ~/.lark/skills/
	homeDir, err := os.UserHomeDir()
	if err == nil {
		if skill := l.loadFromDir(filepath.Join(homeDir, ".lark", "skills"), name); skill != nil {
			return skill, nil
		}
	}

	// 3. 内置 skills
	if skill := l.loadBuiltin(name); skill != nil {
		return skill, nil
	}

	return nil, fmt.Errorf("skill not found: %s", name)
}

// ListAll 列出所有可用的 skills
func (l *Loader) ListAll() []*Skill {
	var skills []*Skill
	skills = append(skills, l.listBuiltin()...)
	return skills
}

// RenderPrompt 渲染 skill 的 prompt 模板，替换 $ARGUMENTS
func (l *Loader) RenderPrompt(skill *Skill, arguments string) string {
	return strings.ReplaceAll(skill.PromptTemplate, "$ARGUMENTS", arguments)
}

// loadFromDir 从指定目录加载 skill
func (l *Loader) loadFromDir(dir, name string) *Skill {
	path := filepath.Join(dir, name+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return parseSkillFile(name, string(data))
}

// loadBuiltin 加载内置 skill
func (l *Loader) loadBuiltin(name string) *Skill {
	// 内置 skills 硬编码
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

// listBuiltin 列出所有内置 skills
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

// parseSkillFile 解析 skill 文件（YAML frontmatter + 正文）
func parseSkillFile(name, content string) *Skill {
	skill := &Skill{
		Name:           name,
		PromptTemplate: content,
	}

	// 解析 YAML frontmatter
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

// 内置 skill 定义
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
