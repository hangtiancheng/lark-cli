package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/hooks"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/remote"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/tui"
)

func main() {
	if args, ok := parseTeammateFlags(os.Args[1:]); ok {
		if err := runTeammate(args); err != nil {
			fmt.Fprintf(os.Stderr, "teammate: %s\n", err)
			os.Exit(1)
		}
		return
	}

	// 解析 --remote 模式
	remoteAddr := ""
	for i := 1; i < len(os.Args); i++ {
		if os.Args[i] == "--remote" {
			remoteAddr = ":18888"
			if i+1 < len(os.Args) && os.Args[i+1][0] != '-' {
				remoteAddr = os.Args[i+1]
				i++
			}
		}
	}

	cfg, err := config.LoadConfig("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		os.Exit(1)
	}

	validHooks := cfg.Hooks
	if err := hooks.Validate(validHooks); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: hook configuration is invalid, starting with no hooks:\n%s\n", err)
		validHooks = nil
	}

	// --remote 模式：启动 HTTP + WebSocket 服务器，浏览器访问 Web UI
	if remoteAddr != "" {
		srv := remote.NewServer(cfg.Providers, cfg.MCPServers, validHooks, remoteAddr)
		if err := srv.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Remote server error: %s\n", err)
			os.Exit(1)
		}
		return
	}

	m := tui.New(cfg.Providers, cfg.MCPServers, validHooks)
	p := tea.NewProgram(m)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		os.Exit(1)
	}
}
