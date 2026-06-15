package trace_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/trace"
)

func TestWriterCreateAndWrite(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(path)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	w.Write(trace.Record{
		TS:        "2024-01-01T00:00:00Z",
		Direction: "out",
		Layer:     "llm",
		Kind:      "request",
		RunID:     "run-1",
		Step:      1,
		Data:      map[string]any{"model": "claude-3"},
	})

	w.Write(trace.Record{
		TS:        "2024-01-01T00:00:01Z",
		Direction: "in",
		Layer:     "llm",
		Kind:      "response",
		RunID:     "run-1",
		Step:      1,
		Data:      map[string]any{"stop_reason": "end_turn"},
	})

	w.Stop()

	// 验证文件内容
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read trace file: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}

	// 验证每行是有效 JSON
	var rec1 map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &rec1); err != nil {
		t.Fatalf("invalid JSON on line 1: %v", err)
	}
	if rec1["direction"] != "out" {
		t.Errorf("expected direction 'out', got %v", rec1["direction"])
	}
	if rec1["run_id"] != "run-1" {
		t.Errorf("expected run_id 'run-1', got %v", rec1["run_id"])
	}

	var rec2 map[string]any
	if err := json.Unmarshal([]byte(lines[1]), &rec2); err != nil {
		t.Fatalf("invalid JSON on line 2: %v", err)
	}
	if rec2["kind"] != "response" {
		t.Errorf("expected kind 'response', got %v", rec2["kind"])
	}
}

func TestWriterAppendMode(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "trace.ndjson")

	// 第一次写入
	w1, err := trace.NewWriter(path)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}
	w1.Write(trace.Record{TS: "1", Direction: "out", Layer: "a", Kind: "x"})
	w1.Stop()

	// 第二次写入（追加模式）
	w2, err := trace.NewWriter(path)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}
	w2.Write(trace.Record{TS: "2", Direction: "in", Layer: "b", Kind: "y"})
	w2.Stop()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines (append mode), got %d", len(lines))
	}
}

func TestWriterAutoCreateDir(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "deep", "nested", "trace.ndjson")

	w, err := trace.NewWriter(path)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}
	w.Write(trace.Record{TS: "1", Direction: "out", Layer: "test", Kind: "test"})
	w.Stop()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Error("expected trace file to be created in nested directory")
	}
}

func TestWriterStopFlushes(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "trace.ndjson")

	w, err := trace.NewWriter(path)
	if err != nil {
		t.Fatalf("NewWriter failed: %v", err)
	}

	// 写入多条记录
	for i := 0; i < 10; i++ {
		w.Write(trace.Record{TS: "1", Direction: "out", Layer: "test", Kind: "test"})
	}

	// Stop 应该刷新队列
	w.Stop()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 10 {
		t.Errorf("expected 10 lines after Stop, got %d", len(lines))
	}
}

func TestRecordSerialization(t *testing.T) {
	rec := trace.Record{
		TS:        "2024-01-01T00:00:00Z",
		Direction: "out",
		Layer:     "llm",
		Kind:      "request",
		RunID:     "run-abc",
		Step:      3,
		ClientID:  "client-1",
		Data:      map[string]any{"key": "value"},
	}

	data, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded trace.Record
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if decoded.TS != rec.TS {
		t.Errorf("TS mismatch: %s vs %s", decoded.TS, rec.TS)
	}
	if decoded.RunID != rec.RunID {
		t.Errorf("RunID mismatch: %s vs %s", decoded.RunID, rec.RunID)
	}
	if decoded.Step != rec.Step {
		t.Errorf("Step mismatch: %d vs %d", decoded.Step, rec.Step)
	}
}
