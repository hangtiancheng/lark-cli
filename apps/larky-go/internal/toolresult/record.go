package toolresult

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Record is one transcript line: a single replacement decision made by
// Apply, suitable for jsonl persistence so Reconstruct can rebuild state on
// resume.
type Record struct {
	Kind        string `json:"kind"`
	ToolUseID   string `json:"tool_use_id"`
	Replacement string `json:"replacement"`
}

// RecordsFilename is the per-session transcript file name.
const RecordsFilename = "replacement_records.jsonl"

// AppendRecords writes records to <sessionDir>/replacement_records.jsonl in
// append mode. Creates the directory if needed. Empty input is a no-op.
func AppendRecords(sessionDir string, records []Record) error {
	if len(records) == 0 {
		return nil
	}
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(sessionDir, RecordsFilename)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, r := range records {
		if r.Kind == "" {
			r.Kind = "tool-result"
		}
		if err := enc.Encode(r); err != nil {
			return err
		}
	}
	return nil
}

// LoadRecords reads the jsonl file. Missing file returns (nil, nil) so
// callers can treat first-run and resume identically.
func LoadRecords(sessionDir string) ([]Record, error) {
	path := filepath.Join(sessionDir, RecordsFilename)
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []Record
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var r Record
		if err := json.Unmarshal(line, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
