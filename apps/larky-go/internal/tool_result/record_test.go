package tool_result

import (
	"path/filepath"
	"testing"
)

func TestAppendAndLoadRecordsRoundtrip(t *testing.T) {
	dir := t.TempDir()
	first := []Record{
		{ToolUseID: "a", Replacement: "aaa"},
		{ToolUseID: "b", Replacement: "bbb"},
	}
	if err := AppendRecords(dir, first); err != nil {
		t.Fatalf("AppendRecords first: %v", err)
	}
	if err := AppendRecords(dir, []Record{{ToolUseID: "c", Replacement: "ccc"}}); err != nil {
		t.Fatalf("AppendRecords second: %v", err)
	}

	loaded, err := LoadRecords(dir)
	if err != nil {
		t.Fatalf("LoadRecords: %v", err)
	}
	if len(loaded) != 3 {
		t.Fatalf("expected 3 records, got %d", len(loaded))
	}
	wantIDs := []string{"a", "b", "c"}
	for i, r := range loaded {
		if r.ToolUseID != wantIDs[i] {
			t.Fatalf("record %d id: got %q want %q", i, r.ToolUseID, wantIDs[i])
		}
		if r.Kind != "tool-result" {
			t.Fatalf("record %d kind: got %q (Append should default-fill)", i, r.Kind)
		}
	}

	path := filepath.Join(dir, RecordsFilename)
	if path == "" {
		t.Fatal("RecordsFilename empty")
	}
}

func TestLoadRecordsMissingFile(t *testing.T) {
	loaded, err := LoadRecords(t.TempDir())
	if err != nil {
		t.Fatalf("LoadRecords on missing file: %v", err)
	}
	if loaded != nil {
		t.Fatalf("expected nil records on missing file, got %v", loaded)
	}
}
