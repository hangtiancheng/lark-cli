package memory

import (
	"os"
)

// LoadContextFile reads a .lark/context.md file from disk.
func LoadContextFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}
