package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tui"
)

func main() {
	// Parse optional --replay <run_id> flag.
	var replayRunID string
	for i := 1; i < len(os.Args); i++ {
		arg := os.Args[i]
		if arg == "--replay" && i+1 < len(os.Args) {
			replayRunID = os.Args[i+1]
			i++
		} else if strings.HasPrefix(arg, "--replay=") {
			replayRunID = strings.TrimPrefix(arg, "--replay=")
		} else if arg == "-h" || arg == "--help" {
			fmt.Println("usage: tui [--replay <run_id>]")
			return
		}
	}

	// Load configuration.
	cfg, err := config.GetConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %s\n", err)
		os.Exit(1)
	}

	// Create and run the TUI.
	m := tui.New(cfg, replayRunID)
	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %s\n", err)
		os.Exit(1)
	}
}
