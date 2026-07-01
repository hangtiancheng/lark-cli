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
	// CustomInstructions holds custom instruction content loaded from LARKY.md and similar instruction files
	CustomInstructions string
	// MemorySection holds persistent memory content loaded from auto-memory
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

	// Custom instructions (priority 80, above environment info but below Skills)
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

	// Persistent memory (priority 95, placed last for maximum model attention)
	if opts.MemorySection != "" {
		b.Add(Section{
			Name:     "Memory",
			Priority: 95,
			Content:  opts.MemorySection,
		})
	}

	return b.Build()
}
