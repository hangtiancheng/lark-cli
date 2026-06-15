package config_test

import (
	"os"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
)

func TestDefaultConfig(t *testing.T) {
	cfg := config.DefaultConfig()

	if cfg.Host != "127.0.0.1" {
		t.Errorf("expected host 127.0.0.1, got %s", cfg.Host)
	}
	if cfg.Port != 7437 {
		t.Errorf("expected port 7437, got %d", cfg.Port)
	}
	if cfg.Agent.MaxSteps != 20 {
		t.Errorf("expected max_steps 20, got %d", cfg.Agent.MaxSteps)
	}
	if cfg.LLM.DefaultModel != "claude-sonnet-4-6" {
		t.Errorf("expected model claude-sonnet-4-6, got %s", cfg.LLM.DefaultModel)
	}
	if cfg.Permission.TimeoutS != 60.0 {
		t.Errorf("expected timeout 60.0, got %f", cfg.Permission.TimeoutS)
	}
	if cfg.Compaction.ToolResultLimit != 8000 {
		t.Errorf("expected tool_result_limit 8000, got %d", cfg.Compaction.ToolResultLimit)
	}
}

func TestApplyEnv(t *testing.T) {
	cfg := config.DefaultConfig()

	// Set env vars
	os.Setenv("LARK_HOST", "0.0.0.0")
	os.Setenv("LARK_PORT", "9999")
	os.Setenv("LARK_MAX_STEPS", "50")
	defer func() {
		os.Unsetenv("LARK_HOST")
		os.Unsetenv("LARK_PORT")
		os.Unsetenv("LARK_MAX_STEPS")
	}()

	// GetConfig should apply env overrides
	result, err := config.GetConfig()
	if err != nil {
		t.Fatal(err)
	}

	if result.Host != "0.0.0.0" {
		t.Errorf("expected host 0.0.0.0, got %s", result.Host)
	}
	if result.Port != 9999 {
		t.Errorf("expected port 9999, got %d", result.Port)
	}
	if result.Agent.MaxSteps != 50 {
		t.Errorf("expected max_steps 50, got %d", result.Agent.MaxSteps)
	}

	_ = cfg // suppress unused
}
