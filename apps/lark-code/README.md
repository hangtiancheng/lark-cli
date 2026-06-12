# LarkCode

ln -s ~/.lark ./.home-lark

A dual-process local AI agent system with a TypeScript implementation of the LarkClaude architecture. It runs an LLM-powered agent that can execute shell commands, read/write files, manage tasks, and coordinate sub-agents through a JSON-RPC 2.0 protocol over TCP.

## Architecture

LarkCode follows a daemon + client architecture:

```
                    TCP (JSON-RPC 2.0)
  CLI / TUI  <-------------------------->  Daemon (lark-core)
   (client)        localhost:7437           |
                                            ├── EventBus (pub/sub)
                                            ├── SessionManager
                                            ├── AgentRunner
                                            │     ├── AgentLoop (plan-act-observe)
                                            │     ├── ToolRegistry
                                            │     │     ├── bash, read_file, write_file, list_dir
                                            │     │     ├── task_create, task_get, task_list, task_update
                                            │     │     ├── note_save
                                            │     │     ├── spawn_agent, agent_result
                                            │     │     └── MCP tools (when configured)
                                            │     ├── Compactor (LLM-driven context compression)
                                            │     └── TracingProvider
                                            ├── PermissionManager (6-tier policy evaluation)
                                            ├── TraceWriter (NDJSON trace log)
                                            └── IpcEventBroadcaster (topic-based event streaming)
```

## Features

### Core Agent

- **Plan-act-observe loop**: Calls the LLM, executes tool calls, appends results, and repeats until the goal is achieved or the step limit is reached.
- **Prompt caching**: Uses Anthropic's cache control for system prompts and tool schemas to reduce API costs.
- **Stream retry**: Automatic retry with exponential backoff (1s, 2s, 4s) on network failures, up to 3 attempts.
- **Context compaction**: LLM-driven conversation summarization with a 6-section structured prompt (Original Goal, Completed Steps, Key Constraints, Current File State, Remaining TODOs, Critical Data).

### Built-in Tools

| Tool           | Description                                                                          |
| -------------- | ------------------------------------------------------------------------------------ |
| `bash`         | Execute shell commands with timeout (1-120s) and 64KB output truncation              |
| `read_file`    | Read file contents with 512KB limit and path traversal protection                    |
| `write_file`   | Write file contents with 1MB limit, auto-creates parent directories                  |
| `list_dir`     | Recursive directory tree with configurable depth (max 4) and entry limit (200)       |
| `note_save`    | Persist session notes for cross-turn context                                         |
| `task_create`  | Create tracked tasks with dependency support                                         |
| `task_get`     | Retrieve task details by ID                                                          |
| `task_list`    | List all tasks with formatted output                                                 |
| `task_update`  | Update task status; completing a task auto-clears it from dependents                 |
| `spawn_agent`  | Spawn isolated sub-agents (foreground or background), supports nesting up to depth 2 |
| `agent_result` | Query background sub-agent status and results                                        |

### Permission System

6-tier evaluation for every tool call:

1. **deny_patterns**: Regex-based auto-deny (bash only)
2. **OUTSIDE_CWD_HEURISTICS**: Forced ASK for commands operating outside the working directory
3. **Session cache**: In-memory per-session always-allow/deny
4. **Persistent cache**: `~/.lark/policy.toml` always-allow/deny
5. **allow_patterns**: Regex-based auto-allow (bash only)
6. **Tool default**: Static policy (bash=ASK, write_file=ASK, read_file=ALLOW, list_dir=ALLOW, note_save=ALLOW)

### Sessions

- **one_shot**: Single-goal execution, closes after completion
- **chat**: Multi-turn interactive sessions with message persistence
- **Skill resolution**: `/skill_name args` syntax triggers skill templates with tool whitelisting
- **Manual compaction**: `session.compact` command compresses thread history via LLM

### Skills

Markdown files with YAML front matter, resolved via 3-tier search (project local > user global > builtin):

- `init` -- Analyze project and generate `.lark/context.md`
- `orchestrate` -- planner -> executor -> reviewer multi-agent workflow
- `review` -- Code review with severity/suggestion/optional classification
- `summarize` -- Compress session conversation into a readable summary

### Agent Profiles

TOML-based role definitions with 3-tier search:

- `planner` -- Read-only goal analysis and task decomposition
- `executor` -- Step-by-step plan execution
- `reviewer` -- Result verification and quality assessment

### Tracing

NDJSON trace log at `~/.lark/traces/daemon.jsonl` with color-coded direction display:

- `CLIENT->CORE` (cyan), `CORE->CLIENT` (yellow), `CORE` (green), `CORE->LLM` (magenta), `LLM->CORE` (blue)
- Supports `--raw` for NDJSON output, `--follow` for tail mode
- Filterable by `--layer` (ipc/event/llm), `--direction`, and `run_id`

## Project Structure

```
lark-code/
├── src/
│   ├── index.ts                    # Version export
│   ├── dev.ts                      # Dev launcher (daemon + TUI)
│   ├── cli/
│   │   ├── main.ts                 # CLI entry point with subcommand dispatch
│   │   └── commands/
│   │       ├── chat.ts             # Multi-turn interactive chat
│   │       ├── core.ts             # Daemon lifecycle (start/stop/status)
│   │       ├── run.ts              # One-shot agent task runner
│   │       ├── trace.ts            # Trace log viewer
│   │       └── version.ts          # Version display
│   ├── core/
│   │   ├── app.ts                  # Daemon entry: TCP server + handler registration
│   │   ├── config.ts               # 4-tier config: defaults -> TOML -> .env -> env vars
│   │   ├── context.ts              # ExecutionContext: messages, step counter, status
│   │   ├── loop.ts                 # AgentLoop: plan-act-observe driver
│   │   ├── runner.ts               # AgentRunner: dependency assembly + run execution
│   │   ├── runs.ts                 # Run ID generation and directory management
│   │   ├── logging.ts              # Pino logger setup
│   │   ├── agents/
│   │   │   ├── loader.ts           # 3-tier agent profile loader
│   │   │   └── builtin/            # planner.toml, executor.toml, reviewer.toml
│   │   ├── bus/
│   │   │   ├── commands.ts        # Zod schemas for all JSON-RPC commands/results
│   │   │   ├── events.ts           # Zod schemas for all 24 event types
│   │   │   ├── envelope.ts         # JSON-RPC 2.0 envelope types
│   │   │   └── index.ts            # Barrel export
│   │   ├── compact/
│   │   │   ├── budget.ts           # Tool result truncation
│   │   │   └── compactor.ts        # LLM-driven context compression
│   │   ├── events/
│   │   │   ├── bus.ts              # EventBus pub/sub
│   │   │   └── writer.ts           # NDJSON event writer
│   │   ├── llm/
│   │   │   ├── base.ts             # LLMProvider interface
│   │   │   ├── provider.ts         # AnthropicProvider with streaming + retry
│   │   │   └── types.ts            # LlmResponse, UsageStats, ToolCallBlock
│   │   ├── mcp/
│   │   │   ├── client.ts           # MCP JSON-RPC client (placeholder)
│   │   │   ├── server.ts           # MCP server manager (placeholder)
│   │   │   └── tool.ts             # MCP tool wrapper
│   │   ├── memory/
│   │   │   └── loader.ts           # Context file loader (~/.lark/context.md)
│   │   ├── permissions/
│   │   │   ├── errors.ts           # PermissionDeniedError
│   │   │   ├── manager.ts          # 6-tier permission evaluation
│   │   │   ├── policy.ts           # Default policies + OUTSIDE_CWD heuristics
│   │   │   └── storage.ts          # policy.toml persistence
│   │   ├── session/
│   │   │   ├── manager.ts          # Session lifecycle, skill resolution, compaction
│   │   │   ├── model.ts            # Session data model + serialization
│   │   │   └── store.ts            # File-based session persistence
│   │   ├── skills/
│   │   │   ├── loader.ts           # 3-tier skill loader with front matter parsing
│   │   │   └── builtin/            # init.md, orchestrate.md, review.md, summarize.md
│   │   ├── subagent/
│   │   │   ├── registry.ts         # Background task registry
│   │   │   └── tool.ts             # SpawnAgentTool + AgentResultTool
│   │   ├── task/
│   │   │   ├── manager.ts          # File-based task CRUD with dependency tracking
│   │   │   └── model.ts            # Task data model + status enum
│   │   ├── tools/
│   │   │   ├── base.ts             # BaseTool interface + ToolResult
│   │   │   ├── errors.ts           # RateLimitedError
│   │   │   ├── invocation.ts       # Tool invocation with permissions + retry
│   │   │   ├── registry.ts         # ToolRegistry with Anthropic schema export
│   │   │   └── builtin/            # 9 built-in tools
│   │   ├── trace/
│   │   │   ├── provider.ts         # TracingProvider decorator
│   │   │   ├── record.ts           # TraceRecord schema (snake_case)
│   │   │   └── writer.ts           # Synchronous NDJSON trace writer
│   │   └── transport/
│   │       ├── ipc-broadcaster.ts  # Topic-based event broadcasting
│   │       ├── socket-client.ts    # TCP JSON-RPC client
│   │       └── socket-server.ts    # TCP JSON-RPC server
│   └── tui/
│       ├── index.ts                # TUI entry point
│       ├── run-tui.ts              # TUI launcher
│       ├── app.tsx                 # Main TUI application (Ink + React)
│       ├── theme.ts                # Tailwind-aligned color palette
│       └── components/             # 7 React components
├── tests/
│   ├── integration/
│   │   └── ping-roundtrip.test.ts  # End-to-end TCP ping test
│   └── unit/                       # 42 unit test files
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- `ANTHROPIC_API_KEY` environment variable

## Getting Started

```bash
# Install dependencies
pnpm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start daemon + TUI
pnpm dev

# Or start them separately:
pnpm dev:core    # Daemon only (background)
pnpm dev:tui     # TUI only (requires daemon running)
```

## CLI Commands

```bash
# Check if daemon is running
lark ping

# Run a one-shot agent task
lark run --goal "list all .ts files in src/"

# Start an interactive chat session
lark chat

# Start/stop/check daemon
lark core start
lark core stop
lark core status

# View trace log
lark trace
lark trace --follow           # Tail mode
lark trace --raw              # Raw NDJSON output
lark trace --layer llm        # Filter by layer
lark trace --direction CORE→LLM  # Filter by direction
lark trace <run_id>           # Filter by run ID

# Show version
lark version
```

## Configuration

### 4-tier Priority Chain

1. **Defaults** (built-in)
2. **TOML** (`~/.lark/config.toml` or `.lark/config.toml`)
3. **dotenv** (`.env` file)
4. **Environment variables** (`LARK_*` prefix)

### TOML Configuration

```toml
[core]
host = "127.0.0.1"
port = 7437

[logging]
level = "INFO"
file = "~/.lark/logs/core.log"
format = "text"

[agent]
max_steps = 20

[llm]
default_model = "claude-sonnet-4-6"
router = "static"

[trace]
enabled = true
file = "~/.lark/traces/daemon.jsonl"
include_llm_payload = true

[permission]
timeout_s = 60.0

[compaction]
auto_threshold = 0.0
tool_result_limit = 8000
tool_result_keep = 4000

[[mcp.servers]]
name = "my-server"
transport = "stdio"
command = "npx"
args = ["-y", "my-mcp-server"]
```

### Environment Variables

| Variable                    | Description                         |
| --------------------------- | ----------------------------------- |
| `LARK_CONFIG`               | Path to TOML config file            |
| `LARK_HOST`                 | Daemon bind host                    |
| `LARK_PORT`                 | Daemon bind port                    |
| `LARK_LOG_LEVEL`            | Log level (DEBUG/INFO/WARN/ERROR)   |
| `LARK_LOG_FILE`             | Log file path                       |
| `LARK_MAX_STEPS`            | Maximum agent loop steps            |
| `LARK_LLM_DEFAULT_MODEL`    | Default LLM model                   |
| `LARK_TRACE_ENABLED`        | Enable/disable tracing              |
| `LARK_TRACE_FILE`           | Trace file path                     |
| `LARK_PERMISSION_TIMEOUT_S` | Permission prompt timeout           |
| `LARK_COMPACT_THRESHOLD`    | Auto-compaction threshold (0.0-1.0) |

## JSON-RPC Protocol

All communication uses JSON-RPC 2.0 over TCP with newline-delimited JSON framing.

### Commands

| Method                 | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `core.ping`            | Health check, returns `server_version`, `uptime_ms`, `received_at` |
| `agent.run`            | One-shot agent task, returns `run_id`                              |
| `event.subscribe`      | Subscribe to event topics with glob patterns                       |
| `session.create`       | Create session (one_shot or chat)                                  |
| `session.send_message` | Send message to session                                            |
| `session.get_history`  | Get session message history                                        |
| `session.close`        | Close session                                                      |
| `session.compact`      | Manually compact session thread                                    |
| `permission.respond`   | Respond to permission request                                      |

### Events (24 types)

All events use snake_case field names and a `type` discriminator:

`core.started`, `run.started`, `run.finished`, `step.started`, `step.finished`, `tool.call_started`, `tool.call_finished`, `tool.call_failed`, `llm.token`, `llm.usage`, `llm.model_selected`, `log.line`, `session.created`, `session.message_received`, `session.waiting_for_input`, `session.resumed`, `session.closed`, `context.compacted`, `permission.requested`, `permission.granted`, `permission.denied`, `subagent.started`, `subagent.finished`, `skill.invoked`

## Development

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run all checks
pnpm qa

# Format code
pnpm format

# Generate protocol documentation
pnpm doc
```

### Test Coverage

- **43 test files** with **231 tests**
- Unit tests cover all core modules: bus, compact, config, context, events, llm, memory, permissions, session, skills, subagent, task, tools, trace, transport
- Integration test covers end-to-end TCP JSON-RPC roundtrip
- Coverage reports generated via `pnpm test:coverage` using V8 provider

### Coding Standards

- Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Zero type assertions (`as`), zero `eslint-disable` comments
- Zod v4 schemas for all wire protocol types (snake_case fields)
- Hand-rolled test stubs (no mocking libraries)
- kebab-case filenames, camelCase code identifiers

## Data Directories

| Path                          | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| `~/.lark/config.toml`         | Global configuration                             |
| `~/.lark/policy.toml`         | Persistent permission policies                   |
| `~/.lark/sessions/`           | Session data (meta.json, thread.jsonl, notes.md) |
| `~/.lark/traces/daemon.jsonl` | Trace log                                        |
| `~/.lark/context.md`          | Global context injected into agent runs          |
| `~/.lark/agents/`             | User-global agent profiles                       |
| `~/.lark/skills/`             | User-global skill definitions                    |
| `.lark/config.toml`           | Project-local configuration                      |
| `.lark/context.md`            | Project-local context                            |
| `.lark/agents/`               | Project-local agent profiles                     |
| `.lark/skills/`               | Project-local skill definitions                  |

## License

MIT
