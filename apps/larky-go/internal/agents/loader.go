package agents

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type AgentLoader struct {
	workDir string
	agents  map[string]*AgentDefinition

	// FailedFiles records definition files that failed to parse during the most recent LoadAll. Each
	// entry is "<path>: <reason>".
	FailedFiles []string

	// ErrorWriter receives one-line warnings for parse failures. Defaults to os.Stderr; tests override
	// it to capture output.
	ErrorWriter io.Writer
}

func NewAgentLoader(workDir string) *AgentLoader {
	return &AgentLoader{
		workDir:     workDir,
		agents:      make(map[string]*AgentDefinition),
		ErrorWriter: os.Stderr,
	}
}

// getBuiltinSpecs Verification is feature-gated upstream (`feature('VERIFICATION_AGENT') && `);
// locally that's a LARKY_VERIFICATION_AGENT env var.
func getBuiltinSpecs() map[string]SubAgentSpec {
	result := make(map[string]SubAgentSpec, len(BuiltinSpecs)+1)
	for name, spec := range BuiltinSpecs {
		result[name] = spec
	}
	if os.Getenv("LARKY_VERIFICATION_AGENT") == "true" {
		result[VerificationAgentType] = verificationSpec
	}
	return result
}

func (l *AgentLoader) LoadAll() error {
	l.FailedFiles = l.FailedFiles[:0]
	for name, spec := range getBuiltinSpecs() {
		l.agents[name] = &AgentDefinition{
			AgentType:       spec.Name,
			WhenToUse:       spec.Description,
			DisallowedTools: spec.DisallowedTools,
			Model:           spec.Model,
			MaxTurns:        spec.MaxTurns,
			SystemPrompt:    spec.SystemPromptOverride,
			Background:      spec.Background,
			Source:          "built-in",
		}
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		l.loadDir(filepath.Join(home, ".larky", "agents"), "user")
	}

	if l.workDir != "" {
		l.loadDir(filepath.Join(l.workDir, ".larky", "agents"), "project")
	}

	return nil
}

func (l *AgentLoader) loadDir(dir, source string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		def, err := ParseAgentFile(path)
		if err != nil {
			msg := fmt.Sprintf("%s: %v", path, err)
			l.FailedFiles = append(l.FailedFiles, msg)
			if l.ErrorWriter != nil {
				fmt.Fprintf(l.ErrorWriter, "[larky] agent definition skipped — %s\n", msg)
			}
			continue
		}
		def.Source = source
		l.agents[def.AgentType] = def
	}
}

func (l *AgentLoader) Get(agentType string) *AgentDefinition {
	return l.agents[agentType]
}

func (l *AgentLoader) ListNames() []string {
	names := make([]string, 0, len(l.agents))
	for name := range l.agents {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
