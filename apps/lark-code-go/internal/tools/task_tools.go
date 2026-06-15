package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Task represents a tracked task with status and dependency information.
type Task struct {
	ID          string   `json:"id"`
	Subject     string   `json:"subject"`
	Description string   `json:"description"`
	Status      string   `json:"status"` // pending, in_progress, completed
	BlockedBy   []string `json:"blocked_by,omitempty"`
}

// validStatuses defines the set of allowed task status values.
var validStatuses = map[string]bool{
	"pending":     true,
	"in_progress": true,
	"completed":   true,
	"deleted":     true,
}

// TaskManager manages file-backed CRUD operations for tasks.
type TaskManager struct {
	mu     sync.Mutex
	dir    string
	tasks  []*Task
	nextID int
}

// NewTaskManager creates a new TaskManager and restores state from disk.
func NewTaskManager(dir string) *TaskManager {
	m := &TaskManager{
		dir:    dir,
		nextID: 1,
	}
	// Restore nextID from existing tasks on disk
	_ = m.load()
	return m
}

func (m *TaskManager) load() error {
	path := filepath.Join(m.dir, "tasks.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := json.Unmarshal(data, &m.tasks); err != nil {
		return err
	}
	// Recover nextID from existing tasks to avoid ID collisions after restart
	m.nextID = m.computeNextID()
	return nil
}

// computeNextID scans existing tasks and returns max(ID) + 1 to ensure unique IDs.
func (m *TaskManager) computeNextID() int {
	maxID := 0
	for _, task := range m.tasks {
		if id, err := strconv.Atoi(task.ID); err == nil && id > maxID {
			maxID = id
		}
	}
	return maxID + 1
}

func (m *TaskManager) save() error {
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.tasks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.dir, "tasks.json"), data, 0o644)
}

// Create creates a new task with the given subject and description.
func (m *TaskManager) Create(subject, description string) *Task {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.load()

	task := &Task{
		ID:          strconv.Itoa(m.nextID),
		Subject:     subject,
		Description: description,
		Status:      "pending",
	}
	m.nextID++
	m.tasks = append(m.tasks, task)
	_ = m.save()
	return task
}

// Update updates a task's status and/or blocked_by dependencies.
func (m *TaskManager) Update(id string, status string, blockedBy []string) (*Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.load()

	// Validate status value against the allowed set
	if status != "" && !validStatuses[status] {
		return nil, fmt.Errorf("invalid status %q: must be one of pending, in_progress, completed, deleted", status)
	}

	for _, task := range m.tasks {
		if task.ID == id {
			if status != "" {
				task.Status = status
			}
			if blockedBy != nil {
				task.BlockedBy = blockedBy
			}

			// Automatically remove the completed task ID from other tasks' blocked_by references
			if status == "completed" {
				m.clearBlockedBy(id)
			}

			_ = m.save()
			return task, nil
		}
	}
	return nil, fmt.Errorf("task %s not found", id)
}

// clearBlockedBy removes the specified task ID from all tasks' blocked_by lists.
func (m *TaskManager) clearBlockedBy(completedID string) {
	for _, task := range m.tasks {
		if task.ID == completedID {
			continue
		}
		filtered := make([]string, 0, len(task.BlockedBy))
		for _, bid := range task.BlockedBy {
			if bid != completedID {
				filtered = append(filtered, bid)
			}
		}
		task.BlockedBy = filtered
	}
}

// FormatList returns a human-readable summary of all tasks.
func (m *TaskManager) FormatList() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.load()

	if len(m.tasks) == 0 {
		return "no tasks"
	}

	var lines []string
	for _, task := range m.tasks {
		icon := "○"
		switch task.Status {
		case "completed":
			icon = "✓"
		case "in_progress":
			icon = "▶"
		case "deleted":
			icon = "✗"
		}
		line := fmt.Sprintf("%s #%s %s [%s]", icon, task.ID, task.Subject, task.Status)
		if len(task.BlockedBy) > 0 {
			line += fmt.Sprintf(" (blocked by: %s)", strings.Join(task.BlockedBy, ", "))
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// List returns all tasks.
func (m *TaskManager) List() []*Task {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.load()
	return m.tasks
}

// Get retrieves a single task by its ID.
func (m *TaskManager) Get(id string) (*Task, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = m.load()

	for _, task := range m.tasks {
		if task.ID == id {
			return task, nil
		}
	}
	return nil, fmt.Errorf("task %s not found", id)
}

// -- TaskCreateTool --

type TaskCreateTool struct {
	manager *TaskManager
}

func NewTaskCreateTool(m *TaskManager) *TaskCreateTool {
	return &TaskCreateTool{manager: m}
}

func (t *TaskCreateTool) Name() string        { return "task_create" }
func (t *TaskCreateTool) Description() string { return "Create a new tracked task" }
func (t *TaskCreateTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"subject":     map[string]any{"type": "string", "description": "Task title"},
			"description": map[string]any{"type": "string", "description": "Task description"},
		},
		"required": []string{"subject"},
	}
}

func (t *TaskCreateTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	subject, _ := params["subject"].(string)
	desc, _ := params["description"].(string)
	if subject == "" {
		return &ToolResult{Content: "subject is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}
	task := t.manager.Create(subject, desc)
	return &ToolResult{Content: fmt.Sprintf("created task #%s: %s", task.ID, task.Subject)}, nil
}

// -- TaskUpdateTool --

type TaskUpdateTool struct {
	manager *TaskManager
}

func NewTaskUpdateTool(m *TaskManager) *TaskUpdateTool {
	return &TaskUpdateTool{manager: m}
}

func (t *TaskUpdateTool) Name() string        { return "task_update" }
func (t *TaskUpdateTool) Description() string { return "Update a task's status or dependencies" }
func (t *TaskUpdateTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"task_id":    map[string]any{"type": "string", "description": "Task ID"},
			"status":     map[string]any{"type": "string", "description": "New status: pending, in_progress, completed, deleted"},
			"blocked_by": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Task IDs that block this task"},
		},
		"required": []string{"task_id"},
	}
}

func (t *TaskUpdateTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	id, _ := params["task_id"].(string)
	if id == "" {
		return &ToolResult{Content: "task_id is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}
	status, _ := params["status"].(string)

	var blockedBy []string
	if arr, ok := params["blocked_by"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok {
				blockedBy = append(blockedBy, s)
			}
		}
	}

	task, err := t.manager.Update(id, status, blockedBy)
	if err != nil {
		return &ToolResult{Content: err.Error(), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}
	return &ToolResult{Content: fmt.Sprintf("updated task #%s: status=%s", task.ID, task.Status)}, nil
}

// -- TaskListTool --

type TaskListTool struct {
	manager *TaskManager
}

func NewTaskListTool(m *TaskManager) *TaskListTool {
	return &TaskListTool{manager: m}
}

func (t *TaskListTool) Name() string        { return "task_list" }
func (t *TaskListTool) Description() string { return "List all tracked tasks" }
func (t *TaskListTool) InputSchema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
}

func (t *TaskListTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	return &ToolResult{Content: t.manager.FormatList()}, nil
}

// -- TaskGetTool --

type TaskGetTool struct {
	manager *TaskManager
}

func NewTaskGetTool(m *TaskManager) *TaskGetTool {
	return &TaskGetTool{manager: m}
}

func (t *TaskGetTool) Name() string        { return "task_get" }
func (t *TaskGetTool) Description() string { return "Get details of a specific task" }
func (t *TaskGetTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"task_id": map[string]any{"type": "string", "description": "Task ID"},
		},
		"required": []string{"task_id"},
	}
}

func (t *TaskGetTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	id, _ := params["task_id"].(string)
	if id == "" {
		return &ToolResult{Content: "task_id is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}

	task, err := t.manager.Get(id)
	if err != nil {
		return &ToolResult{Content: err.Error(), IsError: true, ErrorType: ErrorTypeRuntime}, nil
	}

	data, _ := json.MarshalIndent(task, "", "  ")
	return &ToolResult{Content: string(data)}, nil
}
