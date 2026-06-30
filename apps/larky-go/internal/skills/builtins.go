package skills

import (
	"embed"
	"io/fs"
	"path/filepath"
	"strings"
)

//go:embed builtins/*
var builtinsFS embed.FS

// LoadBuiltins parses every embedded skill under builtins/. Each top-level
// subdir is a skill; we expect a SKILL.md inside. Bodies are loaded eagerly
// at startup since the FS is in-memory anyway. Errors on individual entries
// log nothing and are skipped — same policy as on-disk loaders.
func LoadBuiltins() []*Skill {
	var result []*Skill
	entries, err := builtinsFS.ReadDir("builtins")
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		mdPath := filepath.Join("builtins", name, "SKILL.md")
		data, err := builtinsFS.ReadFile(mdPath)
		if err != nil {
			continue
		}
		skill, err := loadSkillFromBytes(name, data)
		if err != nil {
			continue
		}
		skill.IsDirectory = builtinHasToolJSON(name)
		result = append(result, skill)
	}
	return result
}

// builtinHasToolJSON peeks the embedded tree for a tool.json under the
// skill's dir. Used to flag directory-type builtins (e.g. backend-interview).
func builtinHasToolJSON(skillName string) bool {
	_, err := builtinsFS.ReadFile(filepath.Join("builtins", skillName, "tool.json"))
	return err == nil
}

// BuiltinToolJSON returns the raw tool.json bytes for an embedded skill, or
// nil if the skill isn't a directory-type builtin. Used by directory.go to
// hydrate the schema list.
func BuiltinToolJSON(skillName string) []byte {
	data, err := builtinsFS.ReadFile(filepath.Join("builtins", skillName, "tool.json"))
	if err != nil {
		return nil
	}
	return data
}

// walkBuiltinReferences returns all reference file paths under a builtin
// skill, used by tests and future loaders. Not currently called in
// production but kept here as a documented entry point — remove when the
// directory tool registration uses pre-compiled Go imports exclusively.
func walkBuiltinReferences(skillName string) []string {
	var out []string
	root := filepath.Join("builtins", skillName, "references")
	_ = fs.WalkDir(builtinsFS, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, ".md") {
			return nil
		}
		out = append(out, path)
		return nil
	})
	return out
}
