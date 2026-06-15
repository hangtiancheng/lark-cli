package subagent

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// TaskEntry represents a background subagent task.
type TaskEntry struct {
	RunID  string
	Status string // "running", "success", "failed"
	Result string
}

// Registry tracks background subagent tasks.
type Registry struct {
	mu    sync.RWMutex
	tasks map[string]*TaskEntry
}

// NewRegistry creates a new background task registry.
func NewRegistry() *Registry {
	return &Registry{
		tasks: make(map[string]*TaskEntry),
	}
}

// Register registers a new background task as running.
func (r *Registry) Register(runID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tasks[runID] = &TaskEntry{
		RunID:  runID,
		Status: "running",
	}
}

// Complete marks a task as successfully completed.
func (r *Registry) Complete(runID, result string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.tasks[runID]; ok {
		entry.Status = "success"
		entry.Result = result
	}
}

// Fail marks a task as failed with the given reason.
func (r *Registry) Fail(runID, reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.tasks[runID]; ok {
		entry.Status = "failed"
		entry.Result = reason
	}
}

// Get retrieves the task entry by run ID.
func (r *Registry) Get(runID string) (*TaskEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.tasks[runID]
	return entry, ok
}

// GenerateRunID generates a new unique run ID.
func GenerateRunID() string {
	return fmt.Sprintf("run-%s", uuid.New().String()[:12])
}

// Ensure unused import doesn't cause issues
var _ = context.Background
