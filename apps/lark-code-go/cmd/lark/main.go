package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

const cliVersion = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "ping":
		cmdPing()
	case "run":
		cmdRun()
	case "chat":
		cmdChat()
	case "core":
		cmdCore()
	case "trace":
		cmdTrace()
	case "version", "--version":
		fmt.Printf("lark %s\n", cliVersion)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`lark - CLI client for lark-code daemon

Usage:
  lark ping              Ping the daemon
  lark run --goal "..."  Run an agent task
  lark chat              Interactive multi-turn chat
  lark core start        Start the daemon in background
  lark core stop         Stop the daemon
  lark core status       Check daemon status
  lark trace             View system trace logs
  lark version           Show version
  lark help              Show this help`)
}

func cmdPing() {
	client := connect()
	result, err := client.SendCommand("core.ping", map[string]any{
		"client": "lark-cli",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "ping failed: %s\n", err)
		os.Exit(1)
	}

	var pong struct {
		ServerVersion string `json:"server_version"`
		UptimeMS      int64  `json:"uptime_ms"`
	}
	if err := json.Unmarshal(result, &pong); err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse response: %s\n", err)
		os.Exit(1)
	}

	fmt.Printf("pong from larkd v%s (uptime: %dms)\n", pong.ServerVersion, pong.UptimeMS)
}

func cmdRun() {
	if len(os.Args) < 4 || os.Args[2] != "--goal" {
		fmt.Fprintln(os.Stderr, `usage: lark run --goal "your goal"`)
		os.Exit(1)
	}

	goal := os.Args[3]
	client := connect()

	result, err := client.SendCommand("agent.run", map[string]any{
		"goal": goal,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "run failed: %s\n", err)
		os.Exit(1)
	}

	var runResult struct {
		RunID string `json:"run_id"`
	}
	if err := json.Unmarshal(result, &runResult); err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse response: %s\n", err)
		os.Exit(1)
	}

	fmt.Printf("run started: %s\n", runResult.RunID)

	// Wait for events from the server
	client.OnEvent(func(event json.RawMessage) error {
		var evt struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event, &evt); err != nil {
			return nil
		}
		fmt.Printf("[%s] %s\n", evt.Type, string(event))
		return nil
	})

	<-client.WaitForDisconnect()
}

// cmdChat starts an interactive multi-turn chat session with the daemon.
func cmdChat() {
	client := connect()

	// Create a chat session
	result, err := client.SendCommand("session.create", map[string]any{
		"mode":  "chat",
		"title": "CLI Chat",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "session.create failed: %s\n", err)
		os.Exit(1)
	}

	var sessResult struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(result, &sessResult); err != nil {
		fmt.Fprintf(os.Stderr, "parse error: %s\n", err)
		os.Exit(1)
	}

	sessionID := sessResult.SessionID
	fmt.Printf("Chat session: %s\n", sessionID)
	fmt.Println("Type your message (Ctrl+D to exit):")

	// Subscribe to events and handle them inline
	permPending := make(chan map[string]string, 1)

	client.OnEvent(func(event json.RawMessage) error {
		var evt struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(event, &evt); err != nil {
			return nil
		}

		var data map[string]any
		_ = json.Unmarshal(event, &data)

		switch evt.Type {
		case "llm.token":
			token, _ := data["token"].(string)
			fmt.Print(token)
		case "run.finished":
			fmt.Println()
		case "permission.requested":
			toolUseID, _ := data["tool_use_id"].(string)
			toolName, _ := data["tool_name"].(string)
			preview, _ := data["param_preview"].(string)

			fmt.Printf("\n? Permission: %s (%s)\n", toolName, preview)
			fmt.Print("  [y] allow  [n] deny  [a] always allow  > ")

			var response string
			fmt.Scanln(&response)

			decision := "deny_once"
			switch strings.ToLower(response) {
			case "y":
				decision = "allow_once"
			case "a":
				decision = "always_allow"
			}

			_, _ = client.SendCommand("permission.respond", map[string]any{
				"tool_use_id": toolUseID,
				"decision":    decision,
			})
		case "tool.call_started":
			name, _ := data["tool_name"].(string)
			fmt.Printf("\n⚙ %s\n", name)
		case "tool.call_finished":
			name, _ := data["tool_name"].(string)
			elapsed, _ := data["elapsed_ms"].(float64)
			fmt.Printf("✓ %s (%.0fms)\n", name, elapsed)
		case "tool.call_failed":
			name, _ := data["tool_name"].(string)
			errMsg, _ := data["error_message"].(string)
			fmt.Printf("✗ %s: %s\n", name, truncateCLI(errMsg, 80))
		}
		return nil
	})

	// Consume the perm channel (used only for signaling)
	go func() {
		for range permPending {
		}
	}()

	// REPL loop
	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			break
		}
		text := scanner.Text()
		if text == "" {
			continue
		}

		_, err := client.SendCommand("session.send_message", map[string]any{
			"session_id": sessionID,
			"content":    text,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "send failed: %s\n", err)
		}
	}

	close(permPending)
	fmt.Println("\nClosing session...")
	_, _ = client.SendCommand("session.close", map[string]any{
		"session_id": sessionID,
	})
	client.Close()
}

// cmdCore handles daemon lifecycle commands: start, stop, status.
func cmdCore() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: lark core <start|stop|status>")
		os.Exit(1)
	}

	switch os.Args[2] {
	case "start":
		cmdCoreStart()
	case "stop":
		cmdCoreStop()
	case "status":
		cmdCoreStatus()
	default:
		fmt.Fprintf(os.Stderr, "unknown core command: %s\n", os.Args[2])
		os.Exit(1)
	}
}

func cmdCoreStart() {
	pidPath := pidFilePath()

	// Check if already running
	if pid, err := readPID(pidPath); err == nil {
		if processAlive(pid) {
			fmt.Fprintf(os.Stderr, "daemon already running (pid %d)\n", pid)
			os.Exit(1)
		}
		// Stale PID file, remove it
		os.Remove(pidPath)
	}

	// Find the larkd binary (same directory as lark)
	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to find executable: %s\n", err)
		os.Exit(1)
	}
	larkdPath := filepath.Join(filepath.Dir(execPath), "larkd")

	// Ensure the directory exists for the PID file
	_ = os.MkdirAll(filepath.Dir(pidPath), 0o755)

	// Launch as background process
	cmd := exec.Command(larkdPath)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start daemon: %s\n", err)
		os.Exit(1)
	}

	// Write PID file
	_ = os.WriteFile(pidPath, []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0o644)
	fmt.Printf("daemon started (pid %d)\n", cmd.Process.Pid)

	// Release the process so it doesn't get killed when we exit
	_ = cmd.Process.Release()
}

func cmdCoreStop() {
	pidPath := pidFilePath()
	pid, err := readPID(pidPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "daemon not running (no PID file)")
		os.Exit(1)
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		fmt.Fprintf(os.Stderr, "process not found: %s\n", err)
		os.Exit(1)
	}

	if err := proc.Signal(syscall.SIGTERM); err != nil {
		fmt.Fprintf(os.Stderr, "failed to stop daemon: %s\n", err)
		os.Exit(1)
	}

	_ = os.Remove(pidPath)
	fmt.Printf("daemon stopped (pid %d)\n", pid)
}

func cmdCoreStatus() {
	cfg, err := config.GetConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %s\n", err)
		os.Exit(1)
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		fmt.Println("daemon: not running")
		os.Exit(1)
	}
	conn.Close()
	fmt.Printf("daemon: running at %s\n", addr)
}

// cmdTrace reads and displays trace log files.
func cmdTrace() {
	cfg, err := config.GetConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %s\n", err)
		os.Exit(1)
	}

	tracePath := expandUser(cfg.Trace.File)
	follow := false
	category := ""

	// Parse flags
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--follow", "-f":
			follow = true
		case "--category":
			if i+1 < len(os.Args) {
				category = os.Args[i+1]
				i++
			}
		}
	}

	f, err := os.Open(tracePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open trace file: %s\n", err)
		os.Exit(1)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if category != "" && !matchesCategory(line, category) {
			continue
		}
		fmt.Println(line)
	}

	if !follow {
		return
	}

	// Tail mode: seek to end and poll for new lines
	fmt.Println("--- following (Ctrl+C to stop) ---")
	for {
		time.Sleep(500 * time.Millisecond)
		for scanner.Scan() {
			line := scanner.Text()
			if category != "" && !matchesCategory(line, category) {
				continue
			}
			fmt.Println(line)
		}
	}
}

// -- Helper Functions --

func connect() *transport.Client {
	cfg, err := config.GetConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %s\n", err)
		os.Exit(1)
	}

	client := transport.NewClient(cfg.Host, cfg.Port)
	if err := client.Connect(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to connect to daemon: %s\n", err)
		os.Exit(1)
	}

	return client
}

func pidFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".lark", "larkd.pid")
}

func readPID(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var pid int
	_, err = fmt.Sscanf(string(data), "%d", &pid)
	return pid, err
}

func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

func expandUser(path string) string {
	if len(path) >= 2 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

func matchesCategory(line, category string) bool {
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		return false
	}
	kind, _ := record["kind"].(string)
	return kind == category
}

func truncateCLI(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
