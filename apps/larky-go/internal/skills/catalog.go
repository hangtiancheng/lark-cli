package skills

import (
	"fmt"
	"os"
	"path/filepath"
)

// Catalog is the in-memory registry of all loaded skills. Phase-1 entries
// contain only frontmatter (PromptBody empty, BodyLoaded false); GetFull
// triggers a phase-2 read of the body on each call (hot reload).
type Catalog struct {
	skills    map[string]*Skill
	sources   map[string]string // skill name → "builtin" | "user" | "project" | absolute path
	workDir   string            // remembered so Reload can re-scan the same three tiers
	hasReload bool
}

func NewCatalog() *Catalog {
	return &Catalog{
		skills:  make(map[string]*Skill),
		sources: make(map[string]string),
	}
}

// Register adds (or overwrites) a skill in the catalog. The source label is
// surfaced by /skills.
func (c *Catalog) Register(s *Skill, source string) {
	c.skills[s.Meta.Name] = s
	c.sources[s.Meta.Name] = source
}

// Get returns the phase-1 skill (frontmatter only). PromptBody may be empty
// if the catalog was loaded in phase-1 mode.
func (c *Catalog) Get(name string) *Skill {
	return c.skills[name]
}

// GetFull returns the skill with its body loaded. For disk-backed skills the
// body is re-read on every call (hot reload). For embedded builtins the body
// is already in memory; this is a cache hit. On read failure the previously-
// cached body is preserved and the error returned.
func (c *Catalog) GetFull(name string) (*Skill, error) {
	skill, ok := c.skills[name]
	if !ok {
		return nil, fmt.Errorf("unknown skill: %s", name)
	}
	if skill.SourceDir == "" {
		// Embedded skill — body was loaded at startup, nothing to refresh.
		return skill, nil
	}
	if err := loadSkillBody(skill); err != nil {
		// Keep the previously-cached body if any; let caller decide whether
		// to surface the error or fall through.
		if skill.PromptBody == "" {
			return nil, err
		}
		return skill, err
	}
	return skill, nil
}

// List returns metadata for every loaded skill. Order is map-iteration order
// (not sorted) — callers that need stable order should sort by Name.
func (c *Catalog) List() []SkillMeta {
	result := make([]SkillMeta, 0, len(c.skills))
	for _, s := range c.skills {
		result = append(result, s.Meta)
	}
	return result
}

// Source returns the origin label for a skill ("builtin", "user", "project",
// or a path). Returns "" if the skill isn't loaded.
func (c *Catalog) Source(name string) string {
	return c.sources[name]
}

// Reload re-scans all three tiers (builtin + user + project) and rebuilds
// the catalog in place. Used by `/skills reload` and tests.
func (c *Catalog) Reload(workDir string) {
	fresh := LoadCatalog(workDir)
	c.skills = fresh.skills
	c.sources = fresh.sources
	c.workDir = fresh.workDir
}

// LoadCatalog builds a phase-1 catalog by merging three tiers, with later
// sources overriding earlier ones by name (project wins over user wins over
// builtin):
//  1. internal/skills/builtins/* (embedded via go:embed, lowest priority)
//  2. ~/.larky/skills/         (user global)
//  3. $workDir/.larky/skills/  (project, highest priority)
//
// Only frontmatter is read at this stage; PromptBody stays empty until
// GetFull is called. Parse failures on individual skills are silently
// skipped — one bad file must not bring down the whole catalog.
func LoadCatalog(workDir string) *Catalog {
	c := NewCatalog()
	c.workDir = workDir

	// Tier 1: embedded builtins
	for _, s := range LoadBuiltins() {
		c.Register(s, "builtin")
	}

	// Tier 2: user global
	if home, err := os.UserHomeDir(); err == nil {
		loadTierInto(c, filepath.Join(home, ".larky", "skills"), "user")
	}

	// Tier 3: project
	loadTierInto(c, filepath.Join(workDir, ".larky", "skills"), "project")

	return c
}

// LoadFromDirectory loads every subdirectory of dir as a skill. Used by tests
// and one-off callers that just want a single tier loaded. Body is read
// eagerly (no two-phase split) so existing test code that touches
// skill.PromptBody continues to work.
func LoadFromDirectory(dir string) (*Catalog, error) {
	c := NewCatalog()
	loadTierEager(c, dir, dir)
	return c, nil
}

// LoadSkills is the legacy two-tier loader kept for backward compatibility
// with code that still pre-loads bodies eagerly. New callers should use
// LoadCatalog + GetFull. Order: user global → project.
func LoadSkills(workDir string) *Catalog {
	c := NewCatalog()
	c.workDir = workDir
	if home, err := os.UserHomeDir(); err == nil {
		loadTierEager(c, filepath.Join(home, ".larky", "skills"), "user")
	}
	loadTierEager(c, filepath.Join(workDir, ".larky", "skills"), "project")
	return c
}

// loadTierInto walks a single tier and registers each subdir as a phase-1
// skill. Errors on individual entries are swallowed.
func loadTierInto(c *Catalog, dir, source string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skill, err := parseFrontmatterOnly(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		c.Register(skill, source)
	}
}

// loadTierEager is like loadTierInto but also reads the body. Used by legacy
// LoadSkills / LoadFromDirectory to preserve old behavior.
func loadTierEager(c *Catalog, dir, source string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		skill, err := parseFrontmatterOnly(path)
		if err != nil {
			continue
		}
		_ = loadSkillBody(skill)
		c.Register(skill, source)
	}
}
