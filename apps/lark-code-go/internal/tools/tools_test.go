package tools_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
)

// -- Registry --

func TestRegistryRegisterAndGet(t *testing.T) {
	reg := tools.NewRegistry()
	tool := tools.NewBashTool()
	reg.Register(tool)

	got, ok := reg.Get("bash")
	if !ok {
		t.Fatal("expected to find bash tool")
	}
	if got.Name() != "bash" {
		t.Errorf("expected name 'bash', got %q", got.Name())
	}
}

func TestRegistryToolSchemas(t *testing.T) {
	reg := tools.NewRegistry()
	reg.Register(tools.NewBashTool())

	tmpDir := t.TempDir()
	reg.Register(tools.NewReadFileTool(tmpDir))

	schemas := reg.ToolSchemas()
	if len(schemas) != 2 {
		t.Errorf("expected 2 schemas, got %d", len(schemas))
	}

	for _, schema := range schemas {
		if _, ok := schema["name"]; !ok {
			t.Error("schema missing 'name' field")
		}
		if _, ok := schema["description"]; !ok {
			t.Error("schema missing 'description' field")
		}
		if _, ok := schema["input_schema"]; !ok {
			t.Error("schema missing 'input_schema' field")
		}
	}
}

// -- BashTool --

func TestBashToolSuccess(t *testing.T) {
	tool := tools.NewBashTool()
	result, err := tool.Invoke(context.Background(), map[string]any{
		"command": "echo hello",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Content != "hello" {
		t.Errorf("expected 'hello', got %q", result.Content)
	}
	if result.IsError {
		t.Error("expected no error")
	}
}

func TestBashToolMissingCommand(t *testing.T) {
	tool := tools.NewBashTool()
	result, err := tool.Invoke(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for missing command")
	}
	if result.ErrorType != tools.ErrorTypeSchema {
		t.Errorf("expected schema_error, got %s", result.ErrorType)
	}
}

func TestBashToolNonZeroExitCode(t *testing.T) {
	tool := tools.NewBashTool()
	result, err := tool.Invoke(context.Background(), map[string]any{
		"command": "exit 2",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Errorf("expected IsError=true for non-zero exit code, got false")
	}
	if result.ErrorType != tools.ErrorTypeRuntime {
		t.Errorf("expected runtime_error, got %s", result.ErrorType)
	}
	if !strings.Contains(result.Content, "[exit 2]") {
		t.Errorf("expected '[exit 2]' in output, got %q", result.Content)
	}
}

func TestBashToolStderrMerged(t *testing.T) {
	tool := tools.NewBashTool()
	result, err := tool.Invoke(context.Background(), map[string]any{
		"command": "echo stdout_text && echo stderr_text >&2",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(result.Content, "stdout_text") {
		t.Errorf("expected stdout_text in output, got %q", result.Content)
	}
	if !strings.Contains(result.Content, "stderr_text") {
		t.Errorf("expected stderr_text in output, got %q", result.Content)
	}
}

func TestBashToolTimeout(t *testing.T) {
	tool := tools.NewBashTool()
	result, err := tool.Invoke(context.Background(), map[string]any{
		"command": "sleep 10",
		"timeout": 0.1, // 0.1 seconds
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected IsError=true for timeout")
	}
	if result.ErrorType != tools.ErrorTypeTimeout {
		t.Errorf("expected timeout error, got %s", result.ErrorType)
	}
	if !strings.Contains(result.Content, "timed out") {
		t.Errorf("expected 'timed out' in content, got %q", result.Content)
	}
}

func TestBashToolOutputTruncation(t *testing.T) {
	tool := tools.NewBashTool()
	// 生成超过 64KB 的输出
	result, err := tool.Invoke(context.Background(), map[string]any{
		"command": "dd if=/dev/zero bs=1024 count=100 2>/dev/null | tr '\\0' 'A'",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Content) > 65*1024 {
		t.Errorf("expected output to be truncated, got %d bytes", len(result.Content))
	}
}

// -- ReadFileTool --

func TestReadFileToolSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}

	tool := tools.NewReadFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": testFile,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if result.Content != "hello world" {
		t.Errorf("expected 'hello world', got %q", result.Content)
	}
}

func TestReadFileToolNonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewReadFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": filepath.Join(tmpDir, "nonexistent.txt"),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for nonexistent file")
	}
}

func TestReadFileToolMissingPath(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewReadFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for missing path")
	}
	if result.ErrorType != tools.ErrorTypeSchema {
		t.Errorf("expected schema_error, got %s", result.ErrorType)
	}
}

func TestReadFileToolPathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewReadFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": "/etc/passwd",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for path traversal")
	}
	if !strings.Contains(result.Content, "path traversal") {
		t.Errorf("expected 'path traversal' in error, got %q", result.Content)
	}
}

func TestReadFileToolLargeFile(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "large.txt")
	// 写入 600KB 数据（超过 512KB 限制）
	data := strings.Repeat("X", 600*1024)
	if err := os.WriteFile(testFile, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}

	tool := tools.NewReadFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": testFile,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if !strings.Contains(result.Content, "truncated") {
		t.Error("expected truncation message in output")
	}
}

// -- WriteFileTool --

func TestWriteFileToolSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewWriteFileTool(tmpDir)

	targetPath := filepath.Join(tmpDir, "output.txt")
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path":    targetPath,
		"content": "hello world",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}

	// 验证文件内容
	data, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatalf("failed to read written file: %v", err)
	}
	if string(data) != "hello world" {
		t.Errorf("expected 'hello world', got %q", string(data))
	}
}

func TestWriteFileToolAutoCreateDir(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewWriteFileTool(tmpDir)

	targetPath := filepath.Join(tmpDir, "subdir", "deep", "file.txt")
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path":    targetPath,
		"content": "nested",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
}

func TestWriteFileToolPathTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewWriteFileTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path":    "/etc/malicious",
		"content": "bad",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for path traversal")
	}
}

func TestWriteFileToolMissingParams(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewWriteFileTool(tmpDir)

	// Missing path
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"content": "data",
	})
	if !result.IsError || result.ErrorType != tools.ErrorTypeSchema {
		t.Error("expected schema error for missing path")
	}

	// Missing content
	result, _ = tool.Invoke(context.Background(), map[string]any{
		"path": filepath.Join(tmpDir, "test.txt"),
	})
	if !result.IsError || result.ErrorType != tools.ErrorTypeSchema {
		t.Error("expected schema error for missing content")
	}
}

func TestWriteFileToolContentTooLarge(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewWriteFileTool(tmpDir)
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"path":    filepath.Join(tmpDir, "huge.txt"),
		"content": strings.Repeat("X", 2*1024*1024),
	})
	if !result.IsError {
		t.Error("expected error for content too large")
	}
}

// -- ListDirTool --

func TestListDirToolSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	// 创建测试目录结构
	os.MkdirAll(filepath.Join(tmpDir, "subdir"), 0o755)
	os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("data"), 0o644)

	tool := tools.NewListDirTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path":      tmpDir,
		"max_depth": 2.0,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}
	if !strings.Contains(result.Content, "file.txt") {
		t.Errorf("expected 'file.txt' in output, got %q", result.Content)
	}
}

func TestListDirToolNonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewListDirTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": filepath.Join(tmpDir, "nonexistent"),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error for nonexistent directory")
	}
}

func TestListDirToolNotADirectory(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "file.txt")
	os.WriteFile(testFile, []byte("data"), 0o644)

	tool := tools.NewListDirTool(tmpDir)
	result, err := tool.Invoke(context.Background(), map[string]any{
		"path": testFile,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Error("expected error when path is not a directory")
	}
}

// -- NoteSaveTool --

func TestNoteSaveToolSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewNoteSaveTool(tmpDir, "run-1")

	result, err := tool.Invoke(context.Background(), map[string]any{
		"content": "my note",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Errorf("unexpected error: %s", result.Content)
	}

	// 验证文件已写入
	notesPath := filepath.Join(tmpDir, "notes.md")
	data, err := os.ReadFile(notesPath)
	if err != nil {
		t.Fatalf("failed to read notes file: %v", err)
	}
	if !strings.Contains(string(data), "my note") {
		t.Errorf("expected 'my note' in notes file, got %q", string(data))
	}
	if !strings.Contains(string(data), "run-1") {
		t.Errorf("expected 'run-1' in notes file, got %q", string(data))
	}
}

func TestNoteSaveToolMissingContent(t *testing.T) {
	tmpDir := t.TempDir()
	tool := tools.NewNoteSaveTool(tmpDir, "run-1")
	result, _ := tool.Invoke(context.Background(), map[string]any{})
	if !result.IsError {
		t.Error("expected error for missing content")
	}
}

func TestNoteSaveToolNoSessionDir(t *testing.T) {
	tool := tools.NewNoteSaveTool("", "run-1")
	result, _ := tool.Invoke(context.Background(), map[string]any{
		"content": "note",
	})
	if !result.IsError {
		t.Error("expected error for no session dir")
	}
}

// -- TaskManager --

func TestTaskManagerCRUD(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := tools.NewTaskManager(tmpDir)

	// Create
	task := mgr.Create("Test task", "A test description")
	if task.ID == "" {
		t.Error("expected non-empty task ID")
	}
	if task.Subject != "Test task" {
		t.Errorf("expected subject 'Test task', got %q", task.Subject)
	}
	if task.Status != "pending" {
		t.Errorf("expected status 'pending', got %q", task.Status)
	}

	// Update
	updated, err := mgr.Update(task.ID, "in_progress", nil)
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if updated.Status != "in_progress" {
		t.Errorf("expected status 'in_progress', got %q", updated.Status)
	}

	// List
	tasks := mgr.List()
	if len(tasks) != 1 {
		t.Errorf("expected 1 task, got %d", len(tasks))
	}

	// Get
	got, err := mgr.Get(task.ID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.ID != task.ID {
		t.Errorf("expected ID %q, got %q", task.ID, got.ID)
	}

	// Get nonexistent
	_, err = mgr.Get("999")
	if err == nil {
		t.Error("expected error for nonexistent task")
	}
}

func TestTaskManagerNextIDPersistence(t *testing.T) {
	tmpDir := t.TempDir()

	// 第一批：创建 3 个任务
	mgr1 := tools.NewTaskManager(tmpDir)
	mgr1.Create("task 1", "")
	mgr1.Create("task 2", "")
	mgr1.Create("task 3", "")

	// 第二批：新建 TaskManager 实例，ID 应该从 4 开始
	mgr2 := tools.NewTaskManager(tmpDir)
	task4 := mgr2.Create("task 4", "")
	if task4.ID != "4" {
		t.Errorf("expected task ID '4' after restart, got %q", task4.ID)
	}
}

func TestTaskManagerBlockedByAutoClear(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := tools.NewTaskManager(tmpDir)

	task1 := mgr.Create("first", "")
	task2 := mgr.Create("second", "")

	// task2 blocked by task1
	_, err := mgr.Update(task2.ID, "pending", []string{task1.ID})
	if err != nil {
		t.Fatalf("failed to set blocked_by: %v", err)
	}

	// 验证 blocked_by 设置成功
	got2, _ := mgr.Get(task2.ID)
	if len(got2.BlockedBy) != 1 || got2.BlockedBy[0] != task1.ID {
		t.Errorf("expected blocked_by=[%s], got %v", task1.ID, got2.BlockedBy)
	}

	// 完成 task1 -> task2 的 blocked_by 应被自动清理
	_, err = mgr.Update(task1.ID, "completed", nil)
	if err != nil {
		t.Fatalf("failed to complete task1: %v", err)
	}

	got2, _ = mgr.Get(task2.ID)
	if len(got2.BlockedBy) != 0 {
		t.Errorf("expected blocked_by to be cleared after task1 completed, got %v", got2.BlockedBy)
	}
}

func TestTaskManagerStatusValidation(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := tools.NewTaskManager(tmpDir)
	task := mgr.Create("test", "")

	// 有效状态
	_, err := mgr.Update(task.ID, "in_progress", nil)
	if err != nil {
		t.Errorf("expected no error for valid status, got %v", err)
	}

	// 无效状态
	_, err = mgr.Update(task.ID, "invalid_status", nil)
	if err == nil {
		t.Error("expected error for invalid status")
	}
}

func TestTaskManagerFormatList(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := tools.NewTaskManager(tmpDir)

	// 空列表
	result := mgr.FormatList()
	if result != "no tasks" {
		t.Errorf("expected 'no tasks', got %q", result)
	}

	mgr.Create("first task", "")
	mgr.Create("second task", "")

	result = mgr.FormatList()
	if !strings.Contains(result, "first task") {
		t.Errorf("expected 'first task' in FormatList, got %q", result)
	}
	if !strings.Contains(result, "second task") {
		t.Errorf("expected 'second task' in FormatList, got %q", result)
	}
}

// -- Write-then-Read roundtrip (replaces D1 implicit dependency) --

func TestWriteThenReadRoundtrip(t *testing.T) {
	tmpDir := t.TempDir()

	writeTool := tools.NewWriteFileTool(tmpDir)
	readTool := tools.NewReadFileTool(tmpDir)

	targetPath := filepath.Join(tmpDir, "roundtrip.txt")
	content := "roundtrip test content"

	// Write
	wResult, err := writeTool.Invoke(context.Background(), map[string]any{
		"path":    targetPath,
		"content": content,
	})
	if err != nil {
		t.Fatalf("write error: %v", err)
	}
	if wResult.IsError {
		t.Fatalf("write failed: %s", wResult.Content)
	}

	// Read
	rResult, err := readTool.Invoke(context.Background(), map[string]any{
		"path": targetPath,
	})
	if err != nil {
		t.Fatalf("read error: %v", err)
	}
	if rResult.IsError {
		t.Fatalf("read failed: %s", rResult.Content)
	}
	if rResult.Content != content {
		t.Errorf("expected %q, got %q", content, rResult.Content)
	}
}
