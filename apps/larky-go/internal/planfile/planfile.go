package planfile

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const PlansDir = ".larky/plans"

var currentPlanPath string

func plansDir(workDir string) string {
	return filepath.Join(workDir, PlansDir)
}

func generateSlug() string {
	adjectives := []string{
		"bright", "calm", "bold", "swift", "quiet",
		"vivid", "clear", "keen", "warm", "cool",
		"sharp", "light", "deep", "pure", "soft",
	}
	nouns := []string{
		"plan", "draft", "design", "sketch", "blueprint",
		"outline", "strategy", "approach", "scheme", "map",
		"vision", "path", "route", "guide", "frame",
	}
	now := time.Now()
	ai := int(now.UnixNano()/1000) % len(adjectives)
	ni := int(now.UnixNano()/100) % len(nouns)
	return fmt.Sprintf("%s-%s-%s", adjectives[ai], nouns[ni], now.Format("0102-1504"))
}

func GetOrCreatePlanPath(workDir string) string {
	if currentPlanPath != "" {
		return currentPlanPath
	}
	dir := plansDir(workDir)
	os.MkdirAll(dir, 0o755)
	slug := generateSlug()
	currentPlanPath = filepath.Join(dir, slug+".md")
	return currentPlanPath
}

func GetPlanFilePath(workDir string) string {
	if currentPlanPath != "" {
		return currentPlanPath
	}
	return GetOrCreatePlanPath(workDir)
}

func ResetPlanPath() {
	currentPlanPath = ""
}

func PlanExists(workDir string) bool {
	if currentPlanPath == "" {
		return false
	}
	_, err := os.Stat(currentPlanPath)
	return err == nil
}

func LoadPlan(workDir string) (string, error) {
	if currentPlanPath == "" {
		return "", nil
	}
	data, err := os.ReadFile(currentPlanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

func SavePlan(workDir, content string) error {
	path := GetOrCreatePlanPath(workDir)
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}
