package subagent

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// TaskEntry 表示一个后台任务
type TaskEntry struct {
	RunID  string
	Status string // "running", "success", "failed"
	Result string
}

// Registry 追踪后台 subagent 任务
type Registry struct {
	mu    sync.RWMutex
	tasks map[string]*TaskEntry
}

// NewRegistry 创建后台任务注册表
func NewRegistry() *Registry {
	return &Registry{
		tasks: make(map[string]*TaskEntry),
	}
}

// Register 注册一个新的后台任务
func (r *Registry) Register(runID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tasks[runID] = &TaskEntry{
		RunID:  runID,
		Status: "running",
	}
}

// Complete 标记任务完成
func (r *Registry) Complete(runID, result string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.tasks[runID]; ok {
		entry.Status = "success"
		entry.Result = result
	}
}

// Fail 标记任务失败
func (r *Registry) Fail(runID, reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.tasks[runID]; ok {
		entry.Status = "failed"
		entry.Result = reason
	}
}

// Get 获取任务状态
func (r *Registry) Get(runID string) (*TaskEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.tasks[runID]
	return entry, ok
}

// GenerateRunID 生成新的 run ID
func GenerateRunID() string {
	return fmt.Sprintf("run-%s", uuid.New().String()[:12])
}

// Ensure unused import doesn't cause issues
var _ = context.Background
