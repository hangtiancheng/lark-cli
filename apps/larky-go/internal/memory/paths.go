package memory

import (
	"os"
	"path/filepath"
	"strings"
)

// AutoMemEntrypointName is the filename of the per-project memory index.
const AutoMemEntrypointName = "MEMORY.md"

// GetAutoMemPath returns the auto-memory directory path for the given
// project root. Shape: <projectRoot>/.larky/memory/
//
// The trailing separator is preserved so prefix-based path matching (e.g.,
// sandbox `HasPrefix` checks) work correctly without falsely matching
// `…/memoryxyz`.
//
// Larky colocates memory with other project-local state under .larky/
// so records show up in the IDE and editors can open them directly.
//
// Resolution order:
//  1. LARKY_REMOTE_MEMORY_DIR env var — used as-is (escape hatch for
//     CI/container scenarios where memory should live elsewhere)
//  2. <projectRoot>/.larky/memory
func GetAutoMemPath(projectRoot string) string {
	if override := os.Getenv("LARKY_REMOTE_MEMORY_DIR"); override != "" {
		return strings.TrimRight(override, string(filepath.Separator)) + string(filepath.Separator)
	}
	abs, err := filepath.Abs(projectRoot)
	if err != nil {
		abs = projectRoot
	}
	return filepath.Join(abs, ".larky", "memory") + string(filepath.Separator)
}

// GetAutoMemEntrypoint returns the path to the MEMORY.md inside the
// auto-memory directory.
func GetAutoMemEntrypoint(projectRoot string) string {
	dir := GetAutoMemPath(projectRoot)
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, AutoMemEntrypointName)
}

// IsAutoMemPath checks if an absolute path is within EITHER the project-level
// or user-level auto-memory directory. Used by the path sandbox to allow
// Writes into either memory dir.
func IsAutoMemPath(absolutePath, projectRoot string) bool {
	abs := filepath.Clean(absolutePath)
	if dir := GetAutoMemPath(projectRoot); dir != "" {
		if strings.HasPrefix(abs+string(filepath.Separator), dir) {
			return true
		}
	}
	if dir := GetUserAutoMemPath(); dir != "" {
		if strings.HasPrefix(abs+string(filepath.Separator), dir) {
			return true
		}
	}
	return false
}

// GetUserAutoMemPath returns the user-level auto-memory directory:
// ~/.larky/memory/. Used for type=user / type=feedback memories that
// follow the human across projects (e.g. coding preferences). Returns ""
// if the home directory cannot be resolved.
//
// Trailing separator is preserved for prefix-based path matching.
func GetUserAutoMemPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".larky", "memory") + string(filepath.Separator)
}

// GetUserAutoMemEntrypoint returns the path to ~/.larky/memory/MEMORY.md.
func GetUserAutoMemEntrypoint() string {
	dir := GetUserAutoMemPath()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, AutoMemEntrypointName)
}

// IsUserAutoMemPath checks if an absolute path is within the user-level
// memory dir. Used in places where we need to distinguish user-scope from
// project-scope (sandbox already accepts both; this is for routing).
func IsUserAutoMemPath(absolutePath string) bool {
	dir := GetUserAutoMemPath()
	if dir == "" {
		return false
	}
	abs := filepath.Clean(absolutePath)
	return strings.HasPrefix(abs+string(filepath.Separator), dir)
}
