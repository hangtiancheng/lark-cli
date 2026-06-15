# larky-go

Go implementation of [larky](../larky) -- an AI coding assistant that runs in your terminal.

Part of the [lark-cli](https://github.com/hangtiancheng/lark-cli) project.

## Overview

larky-go is a ground-up Go port of the TypeScript larky assistant. It targets the same architecture: a persistent daemon exposing a JSON-RPC 2.0 API over TCP, with CLI and TUI clients connecting as needed.

The Go version trades the React/Ink terminal stack for [Bubble Tea](https://github.com/charmbracelet/bubbletea), and swaps the Anthropic/OpenAI TypeScript SDKs for their official Go counterparts.

## Features (planned)

- Multi-provider LLM support (Anthropic, OpenAI, OpenAI-compatible APIs)
- Streaming responses with thinking blocks and tool use
- MCP (Model Context Protocol) tool integration via stdio and TCP transport
- Permission system with multi-layer evaluation and session caching
- Session management with context compaction and skill invocation
- Subagent orchestration with foreground and background execution
- Rich terminal UI with markdown rendering, syntax highlighting, and slash command completion
- Daemon + client architecture with TCP NDJSON JSON-RPC 2.0

## Tech Stack

| Component | Library |
|---|---|
| LLM (Anthropic) | [anthropic-sdk-go](https://github.com/anthropics/anthropic-sdk-go) |
| LLM (OpenAI) | [openai-go](https://github.com/openai/openai-go) |
| MCP | [go-sdk](https://github.com/modelcontextprotocol/go-sdk) |
| TUI framework | [Bubble Tea](https://github.com/charmbracelet/bubbletea) |
| TUI components | [Bubbles](https://github.com/charmbracelet/bubbles) |
| Styling | [Lipgloss](https://github.com/charmbracelet/lipgloss) |
| Markdown rendering | [Glamour](https://github.com/charmbracelet/glamour) |
| Syntax highlighting | [Chroma](https://github.com/alecthomas/chroma) |
| Configuration | YAML ([go.yaml.in](https://go.yaml.in/yaml/v4)) |
| JSON schema | [jsonschema](https://github.com/invopop/jsonschema) |

## Project Structure

```
larky-go/
  cmd/                  # Entry points (daemon, CLI, TUI)
  internal/
    conversation/       # Message history and context management
    llm/                # LLM provider abstraction and streaming
    config/             # YAML configuration loading
    tools/              # Built-in tools and tool registry
    mcp/                # MCP server management
    session/            # Session lifecycle and persistence
    permissions/        # Tool permission evaluation
    agent/              # ReAct agent loop
    transport/          # TCP JSON-RPC server and client
    bus/                # Event types and IPC protocol
  go.mod
  .air.toml             # Hot reload configuration
```

## Development

### Prerequisites

- Go 1.26+
- [air](https://github.com/air-verse/air) for hot reload (optional)

### Install air

```sh
go install github.com/air-verse/air@latest
```

### Run with hot reload

```sh
air
```

This watches for `.go` file changes and automatically rebuilds and restarts the application.

### Build

```sh
go build ./...
```

### Test

```sh
go test ./...
```

### Lint

```sh
go vet ./...
```

## Configuration

Configuration is loaded from YAML files with hierarchical merging:

1. Defaults
2. Global config: `~/.larky/config.yaml`
3. Project config: `.larky/config.yaml`
4. Environment variables (`LARKY_*` prefix)

Example provider configuration:

```yaml
providers:
  - name: anthropic
    protocol: anthropic
    model: claude-sonnet-4-6
    thinking: true
    context_window: 200000
```

API keys are resolved from environment variables:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

## Status

This project is in early development. The conversation manager types have been defined; the remaining modules are being implemented incrementally.

See the sibling [lark-code-go](../lark-code-go) for a more mature Go implementation in the same monorepo.

## License

MIT
