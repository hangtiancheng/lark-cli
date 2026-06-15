package permissions

import (
	"os"

	"github.com/BurntSushi/toml"
)

// LoadPolicy 从 TOML 文件加载权限策略
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

// SavePolicy 将权限策略保存到 TOML 文件
func SavePolicy(path string, store *PolicyStore) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	return toml.NewEncoder(f).Encode(store)
}
