package teams

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// ToolActivity describes a single tool invocation.
type ToolActivity struct {
	ToolName    string
	Description string
}

// NewToolActivity creates a ToolActivity with an auto-generated description.
func NewToolActivity(toolName string, input map[string]interface{}) ToolActivity {
	return ToolActivity{
		ToolName:    toolName,
		Description: describeActivity(toolName, input),
	}
}

func describeActivity(toolName string, input map[string]interface{}) string {
	getStr := func(key string) string {
		if v, ok := input[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	switch toolName {
	case "ReadFile":
		return "Reading " + getStr("file_path")
	case "EditFile":
		return "Editing " + getStr("file_path")
	case "WriteFile":
		return "Writing " + getStr("file_path")
	case "Bash":
		cmd := getStr("command")
		if len(cmd) > 40 {
			cmd = cmd[:40] + "…"
		}
		return "Running " + cmd
	case "Glob":
		return "Searching " + getStr("pattern")
	case "Grep":
		return "Grepping " + getStr("pattern")
	default:
		return toolName
	}
}

// TeammateProgress tracks real-time progress for one teammate.
// All methods are goroutine-safe.
type TeammateProgress struct {
	mu               sync.Mutex
	Name             string
	TeamName         string
	Status           string // "running", "idle", "completed", "failed", "stopped"
	ToolUseCount     int
	TokenCount       int64
	LastActivity     *ToolActivity
	RecentActivities []ToolActivity // max 5
	SpinnerVerb      string
	StartTime        int64 // unix ms
	LastMessage      string
}

func NewTeammateProgress(name, teamName, spinnerVerb string) *TeammateProgress {
	return &TeammateProgress{
		Name:        name,
		TeamName:    teamName,
		Status:      "running",
		SpinnerVerb: spinnerVerb,
		StartTime:   time.Now().UnixMilli(),
	}
}

func (p *TeammateProgress) RecordToolUse(toolName string, input map[string]interface{}) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ToolUseCount++
	act := NewToolActivity(toolName, input)
	p.LastActivity = &act
	p.RecentActivities = append(p.RecentActivities, act)
	if len(p.RecentActivities) > 5 {
		p.RecentActivities = p.RecentActivities[1:]
	}
}

func (p *TeammateProgress) RecordTokens(input, output int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.TokenCount = input + output
}

func (p *TeammateProgress) SetStatus(s string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Status = s
}

func (p *TeammateProgress) GetStatus() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.Status
}

func (p *TeammateProgress) ActivitySummary() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.LastActivity != nil {
		return p.LastActivity.Description
	}
	return p.SpinnerVerb
}

var spinnerVerbs = []string{
	"Accomplishing", "Architecting", "Baking", "Bootstrapping", "Brewing",
	"Calculating", "Churning", "Cogitating", "Composing", "Computing",
	"Concocting", "Contemplating", "Cooking", "Crafting", "Creating",
	"Crunching", "Crystallizing", "Cultivating", "Deliberating", "Enchanting",
	"Envisioning", "Forging", "Generating", "Harmonizing", "Hatching",
	"Ideating", "Imagining", "Incubating", "Inferring", "Manifesting",
	"Mewing", "Mulling", "Musing", "Orchestrating", "Pondering",
	"Purring", "Ruminating", "Simmering", "Sketching", "Synthesizing",
	"Thinking", "Tinkering", "Working", "Wrangling",
}

func randomVerb() string {
	return spinnerVerbs[rand.Intn(len(spinnerVerbs))]
}

func (p *TeammateProgress) GetToolUseCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ToolUseCount
}

func (p *TeammateProgress) GetTokenCount() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.TokenCount
}

// FormatTokens formats a token count for display.
func FormatTokens(n int64) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	}
	if n >= 1_000 {
		return fmt.Sprintf("%.1fk", float64(n)/1_000)
	}
	return fmt.Sprintf("%d", n)
}
