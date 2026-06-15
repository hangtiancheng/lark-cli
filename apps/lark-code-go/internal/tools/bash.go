package tools

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	bashDefaultTimeout = 60 * time.Second
	bashMaxOutput      = 64 * 1024 // 64KB
)

// BashTool executes shell commands and returns their output.
type BashTool struct{}

func NewBashTool() *BashTool { return &BashTool{} }

func (t *BashTool) Name() string        { return "bash" }
func (t *BashTool) Description() string { return "Execute a shell command and return its output" }
func (t *BashTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command": map[string]any{
				"type":        "string",
				"description": "The shell command to execute",
			},
			"timeout": map[string]any{
				"type":        "integer",
				"description": "Timeout in seconds (default 60)",
			},
		},
		"required": []string{"command"},
	}
}

func (t *BashTool) Invoke(ctx context.Context, params map[string]any) (*ToolResult, error) {
	command, ok := params["command"].(string)
	if !ok || command == "" {
		return &ToolResult{Content: "command parameter is required", IsError: true, ErrorType: ErrorTypeSchema}, nil
	}

	timeout := bashDefaultTimeout
	if t, ok := params["timeout"].(float64); ok && t > 0 {
		timeout = time.Duration(t) * time.Second
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", command)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if output != "" {
			output += "\n"
		}
		output += stderr.String()
	}

	// Truncate output if it exceeds the maximum allowed size
	if len(output) > bashMaxOutput {
		output = output[:bashMaxOutput] + "\n... (output truncated)"
	}

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return &ToolResult{
				Content:   fmt.Sprintf("command timed out after %s", timeout),
				IsError:   true,
				ErrorType: ErrorTypeTimeout,
			}, nil
		}

		// Non-zero exit code: set IsError=true and append [exit N] annotation
		exitCode := -1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}

		if output == "" {
			output = err.Error()
		}

		if exitCode != 0 {
			output = fmt.Sprintf("[exit %d]\n%s", exitCode, output)
			return &ToolResult{
				Content:   strings.TrimRight(output, "\n"),
				IsError:   true,
				ErrorType: ErrorTypeRuntime,
			}, nil
		}
	}

	return &ToolResult{Content: strings.TrimRight(output, "\n")}, nil
}
