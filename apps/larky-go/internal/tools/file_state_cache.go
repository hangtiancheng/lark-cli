package tools

import (
	"os"
	"path/filepath"
	"sync"
)

// FileStateCache tracks which files have been read and their modification
// times, enforcing a "read-before-edit" discipline identical to Claude Code.
type FileStateCache struct {
	mu      sync.Mutex
	entries map[string]*fileStateEntry
}

type fileStateEntry struct {
	Content string
	Mtime   int64 // UnixMilli
}

func NewFileStateCache() *FileStateCache {
	return &FileStateCache{
		entries: make(map[string]*fileStateEntry),
	}
}

// Record stores the file content and mtime after a successful read.
func (c *FileStateCache) Record(filePath string, content string, mtime int64) {
	abs := normalizePath(filePath)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[abs] = &fileStateEntry{Content: content, Mtime: mtime}
}

// Check verifies that a file has been read and hasn't been modified since.
// Returns (true, "") if OK, or (false, errorMessage) if the edit should be
// blocked.
func (c *FileStateCache) Check(filePath string) (bool, string) {
	abs := normalizePath(filePath)
	c.mu.Lock()
	entry, exists := c.entries[abs]
	c.mu.Unlock()

	if !exists {
		return false, "Error: file has not been read yet. Read it first before editing."
	}

	info, err := os.Stat(abs)
	if err != nil {
		// File might have been deleted — let the caller handle that.
		return true, ""
	}
	currentMtime := info.ModTime().UnixMilli()
	if currentMtime > entry.Mtime {
		return false, "Error: file has been modified since last read. Read it again before editing."
	}

	return true, ""
}

// Update refreshes the cache entry after a successful edit or write.
func (c *FileStateCache) Update(filePath string, newContent string) {
	abs := normalizePath(filePath)
	info, err := os.Stat(abs)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[abs] = &fileStateEntry{
		Content: newContent,
		Mtime:   info.ModTime().UnixMilli(),
	}
}

func normalizePath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}
