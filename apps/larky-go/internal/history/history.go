package history

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const maxEntries = 200

type entry struct {
	Text string `json:"text"`
	Ts   int64  `json:"ts"`
}

func historyFilePath(dir string) string {
	return filepath.Join(dir, ".larky", "prompt_history.jsonl")
}

func Load(dir string) []string {
	path := historyFilePath(dir)
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var texts []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var e entry
		if json.Unmarshal(scanner.Bytes(), &e) == nil && e.Text != "" {
			texts = append(texts, e.Text)
		}
	}
	return texts
}

func Append(dir string, text string) {
	path := historyFilePath(dir)
	os.MkdirAll(filepath.Dir(path), 0o755)

	existing := Load(dir)

	if len(existing) > 0 && existing[len(existing)-1] == text {
		return
	}

	existing = append(existing, text)
	if len(existing) > maxEntries {
		existing = existing[len(existing)-maxEntries:]
	}

	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	for _, t := range existing {
		data, _ := json.Marshal(entry{Text: t, Ts: time.Now().Unix()})
		w.Write(data)
		w.WriteByte('\n')
	}
	w.Flush()
}
