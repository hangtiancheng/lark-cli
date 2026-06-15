package main

import (
	"encoding/json"
	"fmt"
	"os"

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
