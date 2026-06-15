package permissions

import (
	"os"

	"github.com/BurntSushi/toml"
)

// LoadPolicy loads a permission policy from a TOML file.
func LoadPolicy(path string) (*PolicyStore, error) {
	store := &PolicyStore{Tools: make(map[string]*ToolPolicy)}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, err
	}

	if err := toml.Unmarshal(data, store); err != nil {
		return nil, err
	}

	if store.Tools == nil {
		store.Tools = make(map[string]*ToolPolicy)
	}

	return store, nil
}

// SavePolicy saves a permission policy to a TOML file.
func SavePolicy(path string, store *PolicyStore) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	return toml.NewEncoder(f).Encode(store)
}
