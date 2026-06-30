package prompt

import (
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"
)

type Section struct {
	Name     string
	Priority int
	Content  string
}

type EnvironmentContext struct {
	WorkDir   string
	OS        string
	Arch      string
	Shell     string
	IsGitRepo bool
	GitBranch string
	Model     string
	Date      string
}

type BuildOptions struct {
	// CustomInstructions 是从 LARKY.md 等指令文件加载的自定义指令内容
	CustomInstructions string
	// MemorySection 是从自动记忆中加载的持久记忆内容
	MemorySection string
	SkillSection  string
}

type Builder struct {
	sections []Section
}

func NewBuilder() *Builder {
	return &Builder{}
}

func (b *Builder) Add(s Section) *Builder {
	b.sections = append(b.sections, s)
	return b
}

func (b *Builder) Build() string {
	sort.Slice(b.sections, func(i, j int) bool {
		return b.sections[i].Priority < b.sections[j].Priority
	})

	var parts []string
	for _, s := range b.sections {
		content := strings.TrimSpace(s.Content)
		if content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n\n")
}

func DetectEnvironment(workDir string) EnvironmentContext {
	env := EnvironmentContext{
		WorkDir: workDir,
		OS:      runtime.GOOS,
		Arch:    runtime.GOARCH,
		Shell:   os.Getenv("SHELL"),
		Date:    time.Now().Format("2006-01-02"),
	}

	if env.Shell == "" {
		env.Shell = "bash"
	}

	if out, err := exec.Command("git", "-C", workDir, "rev-parse", "--is-inside-work-tree").Output(); err == nil && strings.TrimSpace(string(out)) == "true" {
		env.IsGitRepo = true
		if branch, err := exec.Command("git", "-C", workDir, "rev-parse", "--abbrev-ref", "HEAD").Output(); err == nil {
			env.GitBranch = strings.TrimSpace(string(branch))
		}
	}

	return env
}

func BuildSystemPrompt(env EnvironmentContext, opts BuildOptions) string {
	b := NewBuilder()

	b.Add(IdentitySection())
	b.Add(SystemSection())
	b.Add(DoingTasksSection())
	b.Add(ExecutingActionsSection())
	b.Add(UsingToolsSection())
	b.Add(ToneStyleSection())
	b.Add(OutputEfficiencySection())
	b.Add(EnvironmentSection(env))

	// 自定义指令（优先级 80，高于环境信息但低于 Skills）
	if opts.CustomInstructions != "" {
		b.Add(Section{
			Name:     "CustomInstructions",
			Priority: 80,
			Content:  "# Project Instructions\n\n" + opts.CustomInstructions,
		})
	}

	if opts.SkillSection != "" {
		b.Add(Section{
			Name:     "Skills",
			Priority: 90,
			Content:  opts.SkillSection,
		})
	}

	// 持久记忆（优先级 95，放在最后以获得最高模型注意力）
	if opts.MemorySection != "" {
		b.Add(Section{
			Name:     "Memory",
			Priority: 95,
			Content:  opts.MemorySection,
		})
	}

	return b.Build()
}
