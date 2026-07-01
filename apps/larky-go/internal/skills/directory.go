package skills

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"larky/internal/tools"
)

// ToolSchema is the function-calling schema declared in a directory-type
// skill's tool.json. Field names match the Anthropic tool-use convention.
type ToolSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// builtinToolFactory builds a fully-functional Tool from a declared schema.
// Used to wire up tool.json declarations to compiled-in Go implementations
// for embedded skills (e.g. backend-interview → parse_resume).
type builtinToolFactory func(schema ToolSchema) tools.Tool

// builtinToolFactories maps a tool name to its compiled-in implementation
// factory. Populated by init() in this package; not user-extensible.
//
// User-supplied directory skills (with tool.json declaring a tool that
// isn't in this map) will get a warning logged at registration time and
// the tool will be silently dropped — no dynamic Go plugin loading.
var builtinToolFactories = map[string]builtinToolFactory{}

// parseToolJSON reads tool.json for a directory-type skill. For embedded
// builtins, falls back to the embed FS via BuiltinToolJSON.
func parseToolJSON(skill *Skill) ([]ToolSchema, error) {
	var data []byte
	var err error

	if skill.SourceDir != "" {
		path := filepath.Join(skill.SourceDir, "tool.json")
		data, err = os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("read tool.json: %w", err)
		}
	}
	if len(data) == 0 {
		data = BuiltinToolJSON(skill.Meta.Name)
	}
	if len(data) == 0 {
		return nil, nil
	}

	var schemas []ToolSchema
	if err := json.Unmarshal(data, &schemas); err != nil {
		return nil, fmt.Errorf("parse tool.json: %w", err)
	}
	return schemas, nil
}

// RegisterDirectoryTools registers every tool declared in a directory-type
// skill's tool.json into the given registry. Returns the count of tools
// successfully registered (skipping the ones with no compiled-in factory).
//
// Idempotent: if a tool with the same Name is already registered, the
// existing one wins and we don't overwrite — that matches the rule that
// "tool.json registers a *new* tool, not redeclare an existing one".
func RegisterDirectoryTools(skill *Skill, registry *tools.Registry) (int, error) {
	schemas, err := parseToolJSON(skill)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, schema := range schemas {
		if registry.Get(schema.Name) != nil {
			continue
		}
		factory, ok := builtinToolFactories[schema.Name]
		if !ok {
			log.Printf("skills: tool.json declares %q but no compiled-in implementation; skipping", schema.Name)
			continue
		}
		registry.Register(factory(schema))
		count++
	}
	return count, nil
}
