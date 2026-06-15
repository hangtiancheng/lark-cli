# lark-code-go

Go implementation of an AI coding assistant that runs as a persistent daemon with CLI and TUI clients.

Part of the [lark-cli](https://github.com/hangtiancheng/lark-cli) project.

## Overview

lark-code-go is a complete Go port of the KamaClaude Python project. It implements a daemon-client architecture where a long-running daemon process exposes a JSON-RPC 2.0 API over TCP, allowing CLI and TUI clients to connect and interact with AI agents.

The system features a full ReAct (Reason-Act) agent loop, multi-tier permission system, session management with context compaction, MCP tool integration, and a rich terminal UI built with Bubble Tea.

## Features

- ReAct agent loop with streaming LLM responses and tool use
- Multi-provider LLM support (Anthropic, OpenAI-compatible APIs)
- 9 built-in tools: bash, read_file, write_file, list_dir, note_save, task management (4 tools)
- MCP (Model Context Protocol) integration for external tool servers
- Multi-tier permission system with session caching and persistent policies
- Session management with context compaction and skill invocation
- Subagent orchestration with foreground and background execution
- Event-driven architecture with 24 event types
- Rich TUI with markdown rendering, permission dialogs, and slash command completion
- Daemon lifecycle management (start/stop/status)
- Trace logging for debugging and observability

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   lark      │      │   tui       │      │   (other    │
│   (CLI)     │      │   (TUI)     │      │   clients)  │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                            │
                    TCP JSON-RPC 2.0
                    (NDJSON over TCP)
                            │
                    ┌───────--──────┐
                    │    larkd      │
                    │   (daemon)    │
                    └───────┬───────┘
                            │
        ┌───────────────────┼──────────────────┐
        │                   │                  │
   ┌────--────┐        ┌────--───┐        ┌───--────┐
   │  Agent   │        │ Session │        │   MCP   │
   │  Loop    │        │ Manager │        │ Servers │
   └────┬───-─┘        └────┬────┘        └─────────┘
        │                   │
   ┌────▼────┐        ┌────▼────┐
   │   Tools  │        │  Compact │
   │ Registry │        │          │
   └-─────────┘        └─-────────┘
```

## Tech Stack

| Component          | Library                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| LLM (Anthropic)    | [anthropic-sdk-go](https://github.com/anthropics/anthropic-sdk-go)                      |
| TUI framework      | [Bubble Tea](https://github.com/charmbracelet/bubbletea)                                |
| TUI components     | [Bubbles](https://github.com/charmbracelet/bubbles)                                     |
| Styling            | [Lipgloss](https://github.com/charmbracelet/lipgloss)                                   |
| Markdown rendering | [Glamour](https://github.com/charmbracelet/glamour)                                     |
| Configuration      | [toml](https://github.com/BurntSushi/toml) + [yaml.v3](https://github.com/go-yaml/yaml) |
| UUID generation    | [google/uuid](https://github.com/google/uuid)                                           |
| MCP                | [go-sdk](https://github.com/modelcontextprotocol/go-sdk)                                |

## Project Structure

```
lark-code-go/
  cmd/
    larkd/          # Daemon entry point
    lark/           # CLI client
    tui/            # TUI client (Bubble Tea)
  internal/
    agent/          # ReAct agent loop and execution context
    agents/         # Agent profile loader (planner/executor/reviewer roles)
    app/            # CoreApp daemon orchestrator
    bus/            # JSON-RPC 2.0 types, 24 event types
    compact/        # Context compaction via LLM summarization
    config/         # Layered configuration (TOML + env vars)
    events/         # In-process EventBus (channel-based pub/sub)
    llm/            # LLM provider interface, Anthropic streaming
    mcp/            # MCP client/server manager
    memory/         # Context file loader (.lark/context.md)
    permissions/    # Multi-tier permission evaluation
    session/        # Session lifecycle and file persistence
    skills/         # Skill loader (YAML frontmatter)
    subagent/       # Subagent spawning and registry
    tools/          # Tool interface, registry, built-in tools
    trace/          # NDJSON trace writer
    transport/      # TCP JSON-RPC server/client, broadcaster
  .air.toml         # Hot reload configuration
  Makefile          # Build automation
```

## Development

### Prerequisites

- Go 1.26+
- [air](https://github.com/air-verse/air) for hot reload (optional)

### Install air

```sh
go install github.com/air-verse/air@latest
```

### Quick Start

```sh
# Start daemon with hot reload
make dev

# In another terminal, build CLI/TUI
make build

# Test the CLI
./lark ping
./lark run --goal "List files in current directory"

# Or use the TUI
./tui
```

### Build

```sh
# Build all three binaries
make build

# Or build individually
go build -o larkd ./cmd/larkd
go build -o lark ./cmd/lark
go build -o tui ./cmd/tui
```

### Test

```sh
# Run all tests
make test

# Run with coverage
make coverage

# Run specific package tests
go test ./internal/permissions -v
```

### Lint

```sh
# Static analysis
make lint

# Or directly
go vet ./...
```

### Clean

```sh
make clean
```

## Configuration

Configuration is loaded from TOML files with 5-layer precedence:

1. Defaults (hardcoded)
2. Global config: `~/.lark/config.toml`
3. Project config: `.lark/config.toml`
4. Dotenv: `.env` file
5. Environment variables (`LARK_*` prefix)

Example `config.toml`:

```toml
[core]
host = "127.0.0.1"
port = 7437

[logging]
level = "INFO"
format = "text"

[agent]
max_steps = 20

[llm]
default_model = "claude-sonnet-4-6"

[permission]
timeout_s = 60

[compaction]
auto_threshold = 0.8
tool_result_limit = 8000
tool_result_keep = 4000
```

Environment variable overrides:

```sh
export LARK_HOST="127.0.0.1"
export LARK_PORT="7437"
export LARK_LOG_LEVEL="DEBUG"
export LARK_MAX_STEPS="30"
export LARK_LLM_DEFAULT_MODEL="claude-opus-4-6"
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Usage

### Daemon Management

```sh
# Start daemon in background
./lark core start

# Check status
./lark core status

# Stop daemon
./lark core stop
```

### CLI Commands

```sh
# Ping the daemon
./lark ping

# Run a one-shot task
./lark run --goal "Explain what this code does"

# Interactive chat session
./lark chat

# View trace logs
./lark trace --follow
./lark trace --category llm
```

### TUI Client

```sh
# Launch the TUI
./tui

# In the TUI:
# - Type messages and press Enter to send
# - Use / to invoke skills (e.g., /review, /summarize)
# - Press y/n/a/d to respond to permission requests
# - Press Ctrl+C to quit
```

### JSON-RPC API

The daemon exposes these methods:

- `core.ping` - Heartbeat check
- `agent.run` - Start an agent run with a goal
- `event.subscribe` - Subscribe to event stream
- `session.create` - Create a session (one_shot or chat mode)
- `session.send_message` - Send a message to a session
- `session.get_history` - Retrieve conversation history
- `session.close` - Close a session
- `permission.respond` - Respond to a permission request
- `session.compact` - Compact session context

Protocol: TCP NDJSON (newline-delimited JSON) with JSON-RPC 2.0 envelope.

Default address: `127.0.0.1:7437`

## Event System

24 event types covering:

- Lifecycle: `core.started`, `run.started`, `run.finished`
- Steps: `step.started`, `step.finished`
- Tools: `tool.call_started`, `tool.call_finished`, `tool.call_failed`
- LLM: `llm.token`, `llm.usage`, `llm.model_selected`
- Sessions: `session.created`, `session.message_received`, `session.waiting_for_input`, `session.resumed`, `session.closed`
- Context: `context.compacted`
- Permissions: `permission.requested`, `permission.granted`, `permission.denied`
- Subagents: `subagent.started`, `subagent.finished`
- Skills: `skill.invoked`
- Logging: `log.line`

Events support topic-based filtering and historical replay from `events.jsonl` files.

## Permission System

6-tier evaluation (highest to lowest priority):

1. **Deny patterns** - Force deny based on tool parameters
2. **OUTSIDE_CWD** - Bash commands accessing paths outside working directory
3. **Session cache** - Per-session approval cache (session_id + tool_name)
4. **Persistent cache** - Cross-session "always allow/deny" decisions
5. **Allow patterns** - Auto-allow based on tool parameters
6. **Default** - Ask user (for bash/write_file) or auto-allow (for read_file/list_dir/note_save)

Permission decisions are persisted to `~/.lark/policy.toml`.

## Skills

Built-in skills (invoke with `/` prefix):

- `/init` - Analyze project and generate context.md
- `/orchestrate` - Plan, execute, and review multi-step tasks
- `/review` - Review code changes with severity classification
- `/summarize` - Compress session into a summary

Custom skills can be defined in:

- Project: `.lark/skills/<name>.md`
- User: `~/.lark/skills/<name>.md`

Skills use YAML frontmatter for metadata (description, allowed_tools, system_prompt).

## Testing

The project includes comprehensive tests:

- 17 test files across 15 packages
- Table-driven tests for configuration, permissions, tools, sessions
- Mock providers for LLM and tool invocations
- Integration tests for event bus and transport layer

Run with:

```sh
make test
```

## License

MIT
