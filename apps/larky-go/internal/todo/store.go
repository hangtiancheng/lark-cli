package todo

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Store struct {
	path string
}

func NewStore(dir, listID string) *Store {
	return &Store{
		path: filepath.Join(dir, ".larky", "tasks", listID+".json"),
	}
}

func (s *Store) Load() ([]*Task, error) {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var tasks []*Task
	if err := json.Unmarshal(data, &tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

func (s *Store) Save(tasks []*Task) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}
