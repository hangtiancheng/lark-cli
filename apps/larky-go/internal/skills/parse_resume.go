package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/tools"
)

func init() {
	builtinToolFactories["parse_resume"] = func(schema ToolSchema) tools.Tool {
		return &parseResumeTool{schema: schema}
	}
}

// parseResumeTool is the compiled-in implementation of the parse_resume tool
// declared in backend-interview/tool.json. It does a light pass over a
// resume file and extracts a structured signal blob: tech stack, projects,
// years of experience. The output is fed back to the backend-interview
// SOP so the sub-agent can tailor questions without re-reading the raw
// resume on every turn.
type parseResumeTool struct {
	schema ToolSchema
}

func (t *parseResumeTool) Name() string { return t.schema.Name }

func (t *parseResumeTool) Description() string { return t.schema.Description }

func (t *parseResumeTool) Category() tools.ToolCategory { return tools.CategoryRead }

func (t *parseResumeTool) Schema() map[string]any {
	return map[string]any{
		"name":         t.schema.Name,
		"description":  t.schema.Description,
		"input_schema": t.schema.InputSchema,
	}
}

func (t *parseResumeTool) Execute(_ context.Context, args map[string]any) tools.ToolResult {
	path, _ := args["file_path"].(string)
	if path == "" {
		return tools.ToolResult{Output: "file_path is required", IsError: true}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return tools.ToolResult{Output: fmt.Sprintf("read resume: %v", err), IsError: true}
	}
	signal := extractResumeSignal(string(raw))
	out, _ := json.MarshalIndent(signal, "", "  ")
	return tools.ToolResult{Output: string(out)}
}

type resumeSignal struct {
	TechStack         []string `json:"tech_stack"`
	Projects          []string `json:"projects"`
	YearsOfExperience int      `json:"years_of_experience"`
}

var (
	techKeywords = []string{
		"Go", "Golang", "Java", "Python", "Rust", "TypeScript", "JavaScript",
		"Node", "Node.js", "React", "Vue", "Angular", "Kotlin", "Scala", "C++",
		"PostgreSQL", "MySQL", "MongoDB", "Redis", "Cassandra", "Elasticsearch",
		"Kafka", "RabbitMQ", "gRPC", "GraphQL", "REST",
		"Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform",
		"Prometheus", "Grafana", "OpenTelemetry",
	}
	yoeRegex     = regexp.MustCompile(`(?i)(\d{1,2})\s*\+?\s*(years?|yrs?)`)
	projectRegex = regexp.MustCompile(`(?im)^\s*(?:[-*•·]|\d+\.)\s+(.{8,140})$`)
)

// extractResumeSignal does a naive single-pass extraction. The interview SOP
// only needs rough signal (which techs to ask about, which projects look
// substantial); we don't aim for full NER here.
func extractResumeSignal(text string) resumeSignal {
	var sig resumeSignal

	seen := map[string]bool{}
	for _, kw := range techKeywords {
		if strings.Contains(strings.ToLower(text), strings.ToLower(kw)) && !seen[kw] {
			sig.TechStack = append(sig.TechStack, kw)
			seen[kw] = true
		}
	}

	if m := yoeRegex.FindStringSubmatch(text); len(m) >= 2 {
		var n int
		_, _ = fmt.Sscanf(m[1], "%d", &n)
		sig.YearsOfExperience = n
	}

	matches := projectRegex.FindAllStringSubmatch(text, -1)
	for _, m := range matches {
		line := strings.TrimSpace(m[1])
		if len(line) < 10 {
			continue
		}
		sig.Projects = append(sig.Projects, line)
		if len(sig.Projects) >= 8 {
			break
		}
	}

	return sig
}
