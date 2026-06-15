package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/agent"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/compact"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/config"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/events"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/mcp"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/permissions"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/session"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/subagent"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/tools"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/trace"
	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/transport"
)

const version = "0.1.0"

// CoreApp is the daemon entry point that assembles and orchestrates all components.
type CoreApp struct {
	startTime time.Time
	cfg       *config.Config

	bus         *events.EventBus
	broadcaster *transport.Broadcaster
	traceWriter *trace.Writer
	server      *transport.Server

	permMgr *permissions.Manager
	sessMgr *session.Manager
	mcpMgr  *mcp.ServerManager

	sessionsDir string

	runningRuns sync.Map // run_id -> context.CancelFunc
}

// NewCoreApp creates a new daemon instance.
func NewCoreApp() *CoreApp {
	return &CoreApp{
		startTime: time.Now(),
	}
}

// Run starts the daemon and blocks until a shutdown signal is received.
func (a *CoreApp) Run() error {
	// 1. Load configuration
	cfg, err := config.GetConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	a.cfg = cfg

	// 2. Configure logging
	setupLogging(cfg)

	slog.Info("starting lark-code daemon", "version", version)

	// 3. Create the EventBus
	a.bus = events.NewEventBus()

	// 4. Set up tracing
	if cfg.Trace.Enabled {
		tracePath := expandUser(cfg.Trace.File)
		a.traceWriter, err = trace.NewWriter(tracePath)
		if err != nil {
			slog.Warn("failed to create trace writer", "error", err)
		} else {
			traceCh := a.bus.Subscribe()
			go func() {
				for evt := range traceCh {
					data, _ := bus.MarshalEvent(evt)
					a.traceWriter.Write(trace.Record{
						TS:        time.Now().UTC().Format(time.RFC3339Nano),
						Direction: "internal",
						Layer:     "event",
						Kind:      evt.EventType(),
						Data:      map[string]any{"raw": string(data)},
					})
				}
			}()
		}
	}

	// 5. Initialize the permission manager
	homeDir, _ := os.UserHomeDir()
	policyPath := filepath.Join(homeDir, ".lark", "policy.toml")
	policy, err := permissions.LoadPolicy(policyPath)
	if err != nil {
		slog.Warn("failed to load policy", "error", err)
		policy = &permissions.PolicyStore{Tools: make(map[string]*permissions.ToolPolicy)}
	}
	cwd, _ := os.Getwd()
	a.permMgr = permissions.NewManager(policy, a.bus, cfg.Permission.TimeoutS, cwd, policyPath)

	// 6. Set up the event broadcaster
	a.broadcaster = transport.NewBroadcaster()
	broadcasterCh := a.bus.Subscribe()
	go func() {
		for evt := range broadcasterCh {
			a.broadcaster.Handle(evt)
		}
	}()

	// 7. Start MCP server connections
	a.mcpMgr = mcp.NewServerManager()
	ctx := context.Background()
	if len(cfg.MCP.Servers) > 0 {
		if err := a.mcpMgr.StartAll(ctx, cfg.MCP.Servers); err != nil {
			slog.Warn("some MCP servers failed to start", "error", err)
		}
	}

	// 8. Initialize session storage and manager
	a.sessionsDir = filepath.Join(homeDir, ".lark", "sessions")
	sessStore := session.NewStore(a.sessionsDir)
	a.sessMgr = session.NewManager(sessStore, a.bus, a.runAgent)

	// 9. Start the TCP server
	a.server = transport.NewServer(cfg.Host, cfg.Port)
	a.server.SetBroadcaster(a.broadcaster)

	// Register JSON-RPC handlers
	a.registerHandlers()

	// Start the server
	if err := a.server.Start(); err != nil {
		return fmt.Errorf("failed to start server: %w", err)
	}

	// Publish the core.started event
	a.bus.Publish(&bus.CoreStartedEvent{
		Type:       "core.started",
		ListenAddr: a.server.Addr(),
		Version:    version,
	})

	// 10. Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	slog.Info("received signal, shutting down", "signal", sig.String())

	// 11. Graceful shutdown
	a.shutdown()

	return nil
}

// registerHandlers registers all JSON-RPC method handlers.
func (a *CoreApp) registerHandlers() {
	a.server.Register("core.ping", a.handlePing)
	a.server.Register("agent.run", a.handleAgentRun)
	a.server.Register("event.subscribe", a.handleSubscribe)
	a.server.Register("session.create", a.handleSessionCreate)
	a.server.Register("session.send_message", a.handleSessionSend)
	a.server.Register("session.get_history", a.handleSessionHistory)
	a.server.Register("session.close", a.handleSessionClose)
	a.server.Register("permission.respond", a.handlePermissionRespond)
	a.server.Register("session.compact", a.handleSessionCompact)
}

// shutdown performs a graceful shutdown of all daemon components.
func (a *CoreApp) shutdown() {
	// Cancel all running agent runs
	a.runningRuns.Range(func(key, value any) bool {
		if cancel, ok := value.(context.CancelFunc); ok {
			cancel()
		}
		return true
	})

	// Stop MCP servers
	if a.mcpMgr != nil {
		a.mcpMgr.StopAll()
	}

	// Stop the TCP server
	if a.server != nil {
		a.server.Stop()
	}

	// Stop the trace writer
	if a.traceWriter != nil {
		a.traceWriter.Stop()
	}

	// Close the EventBus
	if a.bus != nil {
		a.bus.Close()
	}

	slog.Info("daemon stopped")
}

// runAgent executes a single agent run (used as a callback by SessionManager).
func (a *CoreApp) runAgent(sess *session.Session, goal string, systemPromptOverride string, toolWhitelist []string) (string, error) {
	runID := fmt.Sprintf("run-%s", uuid.New().String()[:12])

	// Create a cancellable context for this run
	ctx, cancel := context.WithCancel(context.Background())
	a.runningRuns.Store(runID, cancel)
	defer func() {
		cancel()
		a.runningRuns.Delete(runID)
	}()

	// Create the run output directory
	homeDir, _ := os.UserHomeDir()
	runsDir := filepath.Join(homeDir, ".lark", "sessions", sess.ID, "runs", runID)
	_ = os.MkdirAll(runsDir, 0o755)

	// Create the EventWriter for this run
	evtWriter, err := events.NewEventWriter(runsDir)
	if err != nil {
		slog.Warn("failed to create event writer", "error", err)
	} else {
		evtCh := a.bus.Subscribe()
		go func() {
			evtWriter.Consume(evtCh)
		}()
		defer evtWriter.Stop()
	}

	// Load global and project context files
	globalCtx := agent.LoadContextFile(filepath.Join(homeDir, ".lark", "context.md"))
	projectCtx := agent.LoadContextFile(".lark/context.md")

	// Load session notes
	sessStore := session.NewStore(a.sessionsDir)
	sessionNotes := sessStore.ReadNotes(sess.ID)

	// Build the system prompt
	systemPrompt := agent.BuildSystemPrompt(globalCtx, projectCtx, sessionNotes, systemPromptOverride)

	// Create the LLM provider
	var provider llm.Provider = llm.NewAnthropicProvider(a.cfg.LLM.DefaultModel)
	if a.traceWriter != nil {
		provider = llm.NewTracingProvider(provider, a.traceWriter, a.cfg.Trace.IncludeLLMPayload)
	}

	// Build the tool registry
	registry := a.buildRegistry(toolWhitelist)

	// Create the context compactor
	compactor := compact.NewCompactor(provider, a.bus)

	// Load historical messages from storage
	existingMessages, _ := sessStore.ReadMessages(sess.ID)

	// Create the execution context
	ec := agent.NewExecutionContext(sess.ID, existingMessages, systemPrompt)
	ec.AddUserMessage(goal)

	// Build the AgentLoop configuration
	loopCfg := &agent.LoopConfig{
		MaxSteps:         a.cfg.Agent.MaxSteps,
		CompactThreshold: a.cfg.Compaction.AutoThreshold,
		ToolResultLimit:  a.cfg.Compaction.ToolResultLimit,
		ToolResultKeep:   a.cfg.Compaction.ToolResultKeep,
	}

	// Create and run the AgentLoop
	loop := agent.NewAgentLoop(loopCfg, provider, registry, a.bus, compactor)
	outcome, runErr := loop.Run(ctx, ec, runID)

	// Persist new messages to storage
	if len(ec.NewMessages()) > 0 {
		_ = sessStore.AppendMessages(sess.ID, ec.NewMessages(), runID)
	}

	if runErr != nil {
		return runID, fmt.Errorf("agent run failed: %w (status: %s, reason: %s, steps: %d)",
			runErr, outcome.Status, outcome.Reason, outcome.Steps)
	}

	if outcome.Status == agent.StatusFailed {
		return runID, fmt.Errorf("agent run failed: %s (steps: %d)", outcome.Reason, outcome.Steps)
	}

	return runID, nil
}

// buildRegistry constructs the tool registry with built-in, task, subagent, and MCP tools.
func (a *CoreApp) buildRegistry(whitelist []string) *tools.Registry {
	registry := tools.NewRegistry()
	cwd, _ := os.Getwd()

	// Built-in tools
	allTools := []tools.Tool{
		tools.NewReadFileTool(cwd),
		tools.NewBashTool(),
		tools.NewWriteFileTool(cwd),
		tools.NewListDirTool(cwd),
	}

	// Task management tools
	homeDir, _ := os.UserHomeDir()
	taskMgr := tools.NewTaskManager(filepath.Join(homeDir, ".lark", "tasks"))
	allTools = append(allTools,
		tools.NewTaskCreateTool(taskMgr),
		tools.NewTaskUpdateTool(taskMgr),
		tools.NewTaskListTool(taskMgr),
		tools.NewTaskGetTool(taskMgr),
	)

	// Subagent tools
	taskRegistry := subagent.NewRegistry()
	allTools = append(allTools,
		subagent.NewSpawnAgentTool(taskRegistry, 0),
		subagent.NewAgentResultTool(taskRegistry),
	)

	// MCP tools
	if a.mcpMgr != nil {
		allTools = append(allTools, a.mcpMgr.GetTools()...)
	}

	// Filter tools by whitelist if specified
	if len(whitelist) > 0 {
		allowed := make(map[string]bool)
		for _, name := range whitelist {
			allowed[name] = true
		}
		for _, tool := range allTools {
			if allowed[tool.Name()] {
				registry.Register(tool)
			}
		}
	} else {
		for _, tool := range allTools {
			registry.Register(tool)
		}
	}

	return registry
}

// -- JSON-RPC Handlers --

func (a *CoreApp) handlePing(ctx context.Context, params json.RawMessage) (any, error) {
	return &bus.PongResult{
		ServerVersion: version,
		UptimeMS:      time.Since(a.startTime).Milliseconds(),
		ReceivedAt:    time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (a *CoreApp) handleAgentRun(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.AgentRunCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	sess, err := a.sessMgr.Create(session.ModeOneShot, "")
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	runID, err := a.sessMgr.SendMessage(sess.ID, cmd.Goal)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	return &bus.AgentRunResult{RunID: runID}, nil
}

func (a *CoreApp) handleSubscribe(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.EventSubscribeCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	// Retrieve the current connection's writer (injected by the server via context)
	conn := transport.ConnFromContext(ctx)
	if conn == nil {
		return nil, transport.NewHandlerError(bus.InternalError, "no connection in context")
	}

	// Register the subscription
	topics := cmd.Topics
	if len(topics) == 0 {
		topics = []string{"*"}
	}
	scope := cmd.Scope
	if scope == "" {
		scope = "global"
	}

	subID := a.broadcaster.Subscribe(conn, topics, scope)

	// Event replay from historical events
	replayedCount := 0
	if cmd.ReplayFromRun != "" {
		replayedCount = a.replayEvents(conn, cmd.ReplayFromRun, topics)
	}

	return &bus.EventSubscribeResult{
		SubscriptionID: subID,
		ReplayedCount:  replayedCount,
	}, nil
}

// replayEvents replays historical events from events.jsonl files.
func (a *CoreApp) replayEvents(conn net.Conn, runID string, topics []string) int {
	// Search all session directories for the run's events.jsonl
	homeDir, _ := os.UserHomeDir()
	sessionsDir := filepath.Join(homeDir, ".lark", "sessions")

	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return 0
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		eventsPath := filepath.Join(sessionsDir, entry.Name(), "runs", runID, "events.jsonl")
		count := events.ReplayEventsWithCallback(eventsPath, topics, func(data []byte) {
			envelope := map[string]any{
				"kind":  "event",
				"event": json.RawMessage(data),
			}
			out, err := json.Marshal(envelope)
			if err != nil {
				return
			}
			_, _ = conn.Write(append(out, '\n'))
		})
		if count > 0 {
			return count
		}
	}

	return 0
}

func (a *CoreApp) handleSessionCreate(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.SessionCreateCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	sess, err := a.sessMgr.Create(session.SessionMode(cmd.Mode), cmd.Title)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	return &bus.SessionCreateResult{
		SessionID: sess.ID,
		Status:    bus.SessionStatus(sess.Status),
	}, nil
}

func (a *CoreApp) handleSessionSend(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.SessionSendMessageCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	runID, err := a.sessMgr.SendMessage(cmd.SessionID, cmd.Content)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	return &bus.SessionSendMessageResult{RunID: runID}, nil
}

func (a *CoreApp) handleSessionHistory(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.SessionGetHistoryCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	messages, err := a.sessMgr.GetHistory(cmd.SessionID)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	rawMessages := make([]json.RawMessage, 0, len(messages))
	for _, msg := range messages {
		data, _ := json.Marshal(msg)
		rawMessages = append(rawMessages, data)
	}

	return &bus.SessionGetHistoryResult{Messages: rawMessages}, nil
}

func (a *CoreApp) handleSessionClose(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.SessionCloseCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	if err := a.sessMgr.Close(cmd.SessionID); err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	return &bus.SessionCloseResult{Status: bus.SessionStatusClosed}, nil
}

func (a *CoreApp) handlePermissionRespond(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.PermissionRespondCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	ok := a.permMgr.Respond(cmd.ToolUseID, cmd.Decision)
	return &bus.PermissionRespondResult{OK: ok}, nil
}

func (a *CoreApp) handleSessionCompact(ctx context.Context, params json.RawMessage) (any, error) {
	var cmd bus.SessionCompactCommand
	if err := json.Unmarshal(params, &cmd); err != nil {
		return nil, transport.NewHandlerError(bus.InvalidParams, "invalid params")
	}

	sess, err := a.sessMgr.GetSession(cmd.SessionID)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	// Create the LLM provider
	var provider llm.Provider = llm.NewAnthropicProvider(a.cfg.LLM.DefaultModel)
	if a.traceWriter != nil {
		provider = llm.NewTracingProvider(provider, a.traceWriter, a.cfg.Trace.IncludeLLMPayload)
	}

	compactor := compact.NewCompactor(provider, a.bus)

	// Load historical messages from storage
	sessStore := session.NewStore(a.sessionsDir)
	messages, err := sessStore.ReadMessages(cmd.SessionID)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	if len(messages) == 0 {
		return &bus.SessionCompactResult{
			SummaryTokens: 0,
			SavedTokens:   0,
		}, nil
	}

	runID := ""
	if len(sess.RunIDs) > 0 {
		runID = sess.RunIDs[len(sess.RunIDs)-1]
	}

	compacted, originalTokens, summaryTokens, err := compactor.Compact(ctx, messages, cmd.SessionID, runID, cmd.Focus)
	if err != nil {
		return nil, transport.NewHandlerError(bus.InternalError, err.Error())
	}

	// Write the compacted conversation history
	if err := sessStore.WriteCompacted(cmd.SessionID, compacted); err != nil {
		slog.Warn("failed to write compacted session", "error", err)
	}

	// Write the summary file
	runsDir := sessStore.RunsDir(cmd.SessionID)
	if runID != "" {
		summaryPath := filepath.Join(runsDir, runID, fmt.Sprintf("summary_%d.md", time.Now().Unix()))
		summaryText := ""
		if len(compacted) > 0 {
			if c, ok := compacted[len(compacted)-1]["content"].(string); ok {
				summaryText = c
			}
		}
		_ = os.WriteFile(summaryPath, []byte(summaryText), 0o644)
	}

	return &bus.SessionCompactResult{
		SummaryTokens: summaryTokens,
		SavedTokens:   originalTokens - summaryTokens,
	}, nil
}

// -- Helper Functions --

func setupLogging(cfg *config.Config) {
	level := slog.LevelInfo
	switch cfg.Logging.Level {
	case "DEBUG":
		level = slog.LevelDebug
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	}

	opts := &slog.HandlerOptions{Level: level}

	var handler slog.Handler
	if cfg.Logging.Format == "json" {
		handler = slog.NewJSONHandler(os.Stderr, opts)
	} else {
		handler = slog.NewTextHandler(os.Stderr, opts)
	}

	slog.SetDefault(slog.New(handler))
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
