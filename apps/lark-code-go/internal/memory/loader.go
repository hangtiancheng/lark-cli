package memory

import (
	"os"
)

// LoadContextFile 加载 .lark/context.md 文件
func LoadContextFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}
