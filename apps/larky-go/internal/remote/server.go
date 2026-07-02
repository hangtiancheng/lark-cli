package remote

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"larky/internal/agent"
	"larky/internal/agents"
	"larky/internal/commands"
	"larky/internal/compact"
	"larky/internal/config"
	"larky/internal/conversation"
	"larky/internal/file_history"
	"larky/internal/hooks"
	"larky/internal/llm"
	"larky/internal/mcp"
	"larky/internal/memory"
 "larky/internal/memory/extractor"
	"larky/internal/permissions"
	"larky/internal/plan_file"
	"larky/internal/prompt"
	"larky/internal/session"
	"larky/internal/skills"
	"larky/internal/teams"
	"larky/internal/todo"
	"larky/internal/tools"
	"larky/internal/worktree"
)

// Downstream messages (Server -> Web UI)
type wsMessage struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// Upstream messages (Web UI -> Server)
type clientMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type userMessageData struct {
	Content string `json:"content"`
}

type permResponseData struct {
	ID       string `json:"id"`
	Response string `json:"response"` // "allow" / "deny" / "allowAlways"
}

type askUserResponseData struct {
	ID      string            `json:"id"`
	Answers map[string]string `json:"answers"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Server is the core of Remote Control, bridging Agent events and WebSocket clients
type Server struct {
	providers  []config.ProviderConfig
	mcpConfigs []config.MCPServerConfig
	hookCfgs   []hooks.Hook
	addr       string

	mu    sync.Mutex
	conns map[*websocket.Conn]struct{}

	ag           *agent.Agent
	conv         *conversation.Manager
	registry     *tools.Registry
	defaultTools tools.DefaultTools
	client       llm.Client
	sessionID    string
	fileHistory  *file_history.History

	streaming    bool
	cancelStream context.CancelFunc
	agentCh      <-chan agent.AgentEvent

	askUserCh chan tools.AskUserRequest

	// Block waiting for web client permission/ask_user responses
	pendingPermMu sync.Mutex
	pendingPerms  map[string]chan<- agent.PermissionResponse

	pendingAskMu sync.Mutex
	pendingAsks  map[string]chan tools.QuestionResponse

	cmdRegistry     *commands.Registry
	skillCatalog    *skills.Catalog
	taskMgr         *agents.TaskManager
	todoList        *todo.TaskList
	memoryMgr       *memory.Manager
	memoryExtractor *extractor.Extractor
	teamMgr         *teams.TeamManager
	mcpMgr          *mcp.Manager

	instructionsContent string
	memoryContent       string
	mcpInstructions     string
}

func NewServer(providers []config.ProviderConfig, mcpConfigs []config.MCPServerConfig, hookCfgs []hooks.Hook, addr string) *Server {
	return &Server{
		providers:    providers,
		mcpConfigs:   mcpConfigs,
		hookCfgs:     hookCfgs,
		addr:         addr,
		conns:        make(map[*websocket.Conn]struct{}),
		pendingPerms: make(map[string]chan<- agent.PermissionResponse),
		pendingAsks:  make(map[string]chan tools.QuestionResponse),
	}
}

func (s *Server) Run() error {
	if err := s.initAgent(); err != nil {
		return fmt.Errorf("failed to initialize Agent: %w", err)
	}

	s.initMCPServers()

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/ws", s.handleWS)

	fmt.Printf("\n  🌐 Remote UI: http://localhost%s\n\n", s.addr)
	return http.ListenAndServe(s.addr, mux)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(indexHTML))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	s.mu.Lock()
	s.conns[conn] = struct{}{}
	s.mu.Unlock()

	defer func() {
		conn.Close()
		s.mu.Lock()
		delete(s.conns, conn)
		s.mu.Unlock()
	}()

	conn.SetReadLimit(4 << 20) // 4MB

	s.send(wsMessage{Type: "connected", Data: map[string]string{
		"session": s.sessionID,
		"cwd":     mustGetwd(),
	}})

	// Push command list
	s.send(wsMessage{Type: "commands", Data: s.buildCommandList()})

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		var msg clientMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "user_message":
			var data userMessageData
			json.Unmarshal(msg.Data, &data)
			go s.handleUserMessage(data.Content)

		case "permission_response":
			var data permResponseData
			json.Unmarshal(msg.Data, &data)
			s.handlePermissionResponse(data)

		case "ask_user_response":
			var data askUserResponseData
			json.Unmarshal(msg.Data, &data)
			s.handleAskUserResponse(data)

		case "cancel":
			if s.cancelStream != nil {
				s.cancelStream()
			}

		case "ping":
			// Application-layer keepalive: client sends every 10s, server responds with pong
			s.send(wsMessage{Type: "pong", Data: nil})
		}
	}
}

// initAgent replicates the initialization flow of initSingleProviderMsg in the TUI
func (s *Server) initAgent() error {
	p := &s.providers[0]
	wd, _ := os.Getwd()

	s.askUserCh = make(chan tools.AskUserRequest, 1)
	s.defaultTools = tools.CreateDefaultTools()
	s.registry = s.defaultTools.Registry
	s.registry.Register(&tools.AskUserQuestionTool{RequestCh: s.askUserCh})

	s.cmdRegistry = commands.CreateDefaultRegistry()
	s.skillCatalog = skills.LoadCatalog(wd)
	s.instructionsContent = loadCustomInstructions(wd)
	s.memoryContent = memory.LoadAutoMemoryPrompt(wd)

	skillSection := buildSkillSection(s.skillCatalog, wd)

	env := prompt.DetectEnvironment(wd)
	env.Model = p.Model
	systemPrompt := prompt.BuildSystemPrompt(env, prompt.BuildOptions{
		CustomInstructions: s.instructionsContent,
		MemorySection:      s.memoryContent,
		SkillSection:       skillSection,
	})

	client, err := llm.NewClient(p, systemPrompt)
	if err != nil {
		return err
	}
	s.client = client
	s.conv = conversation.NewManager()
	s.sessionID = session.NewID()
	s.fileHistory = file_history.New(wd, s.sessionID)
	s.defaultTools.EditFile.FileHistory = s.fileHistory
	s.defaultTools.WriteFile.FileHistory = s.fileHistory

	llm.ResolveContextWindow(context.Background(), p)
	s.registerTools(client, p, wd)

	ag := agent.New(client, s.registry, p.Protocol)
	ag.ContextWindow = p.GetContextWindow()
	ag.MaxOutputTokens = p.GetMaxOutputTokens()
	ag.Instructions = s.instructionsContent
	ag.MemoryContent = s.memoryContent
	ag.FileHistory = s.fileHistory
	ag.SetSessionID(s.sessionID)

	sandboxAllow := []string{memory.GetAutoMemPath(wd)}
	if userMem := memory.GetUserAutoMemPath(); userMem != "" {
		sandboxAllow = append(sandboxAllow, userMem)
	}
	ag.Checker = permissions.NewChecker(
		permissions.NewPathSandbox(wd, sandboxAllow...),
		&permissions.RuleEngine{
			LocalPath: filepath.Join(wd, ".larky", "permissions.local.yaml"),
		},
		permissions.ModeDefault,
	)

	if len(s.hookCfgs) > 0 {
		eng := hooks.NewEngine()
		eng.LoadHooks(s.hookCfgs)
		eng.AgentRunner = newAgentHookRunner(client)
		ag.Hooks = eng
	}

	ag.NotificationFn = func() []string { return nil }
	ag.ToolNameFilter = func(name string) bool { return true }

	s.ag = ag

	if at, ok := s.registry.Get("Agent").(*agents.AgentTool); ok {
		at.ParentChecker = ag.Checker
		at.ParentReplacementState = ag.ReplacementState
	}

	s.wireSkillsToAgent(wd)
	s.memoryExtractor = installMemExtractor(ag, wd, p.Protocol, client, s.registry, s.conv)

	gitRoot := worktree.FindCanonicalGitRoot(wd)
	s.registry.Register(&tools.EnterWorktreeTool{SessionID: s.sessionID, RepoRoot: gitRoot})
	s.registry.Register(&tools.ExitWorktreeTool{RepoRoot: gitRoot})
	worktree.StartCleanupLoop(context.Background())

	return nil
}

func (s *Server) registerTools(client llm.Client, p *config.ProviderConfig, wd string) {
	s.taskMgr = agents.NewTaskManager()
	store := todo.NewStore(wd, s.sessionID)
	s.todoList = todo.NewTaskList(store)
	s.memoryMgr = memory.NewManager(wd)
	loader := agents.NewAgentLoader(wd)
	loader.LoadAll()
	s.teamMgr = teams.NewTeamManager()

	s.registry.Register(&tools.ExitPlanModeTool{
		IsPlanMode: func() bool {
			return s.ag != nil && s.ag.Checker != nil && s.ag.Checker.Mode == permissions.ModePlan
		},
		PlanExists: func() bool { return false },
	})
	s.registry.Register(&todo.TaskCreateTool{List: s.todoList})
	s.registry.Register(&todo.TaskGetTool{List: s.todoList})
	s.registry.Register(&todo.TaskListTool{List: s.todoList})
	s.registry.Register(&todo.TaskUpdateTool{List: s.todoList})
	s.registry.Register(&tools.ToolSearchTool{Registry: s.registry, Protocol: p.Protocol})
	s.registry.Register(&teams.TeamCreateTool{TeamMgr: s.teamMgr})
	s.registry.Register(&teams.TeamDeleteTool{TeamMgr: s.teamMgr})
	s.registry.Register(&teams.SendMessageTool{TeamMgr: s.teamMgr, SenderName: "lead"})
	subProgressCh := make(chan agents.SubAgentProgress, 32)
	s.registry.Register(&agents.AgentTool{
		Client:        client,
		ModelResolver: llm.NewModelResolver(*p),
		Registry:      s.registry,
		Protocol:      p.Protocol,
		TaskMgr:       s.taskMgr,
		ProgressCh:    subProgressCh,
		Loader:        loader,
		Conversation:  s.conv,
		TeamMgr:       s.teamMgr,
	})
}

func (s *Server) initMCPServers() {
	if len(s.mcpConfigs) == 0 {
		return
	}
	mgr := mcp.NewManager()
	var serverConfigs []mcp.ServerConfig
	for _, c := range s.mcpConfigs {
		serverConfigs = append(serverConfigs, mcp.ServerConfig{
			Name:      c.Name,
			Command:   c.Command,
			Args:      c.Args,
			URL:       c.URL,
			Transport: c.Transport,
			Headers:   c.Headers,
			Env:       c.Env,
		})
	}
	mgr.LoadConfigs(serverConfigs)
	result := mgr.ConnectAll(context.Background())
	s.mcpMgr = result.Mgr
	for _, t := range result.Tools {
		s.registry.Register(t)
	}
	for _, errMsg := range result.Errors {
		log.Printf("MCP error: %s", errMsg)
	}
	if len(result.Servers) > 0 {
		toolsByServer := make(map[string][]string)
		for _, t := range result.Tools {
			toolName := t.Name()
			for _, srv := range result.Servers {
				if strings.HasPrefix(toolName, "mcp__"+mcp.SanitizeName(srv.Name)+"__") {
					toolsByServer[srv.Name] = append(toolsByServer[srv.Name], toolName)
					break
				}
			}
		}
		var mcpParts []string
		for _, srv := range result.Servers {
			var sb strings.Builder
			fmt.Fprintf(&sb, "## %s\n", srv.Name)
			if srv.Instructions != "" {
				fmt.Fprintf(&sb, "%s\n", srv.Instructions)
			}
			if toolNames, ok := toolsByServer[srv.Name]; ok && len(toolNames) > 0 {
				fmt.Fprintf(&sb, "\nAvailable tools: %s", strings.Join(toolNames, ", "))
			}
			mcpParts = append(mcpParts, sb.String())
		}
		s.mcpInstructions = "# MCP Server Instructions\n\nThe following MCP servers are connected. Use their tools when the user asks.\n\n" + strings.Join(mcpParts, "\n\n")
	}
}

func (s *Server) handleUserMessage(content string) {
	if s.streaming {
		return
	}

	content = strings.TrimSpace(content)
	if content == "" {
		return
	}

	// Slash command handling
	if strings.HasPrefix(content, "/") {
		s.handleSlashCommand(content)
		return
	}

	s.streaming = true
	wd, _ := os.Getwd()
	session.SaveMessage(wd, s.sessionID, session.Message{Role: "user", Content: content, Ts: time.Now().Unix()})
	s.conv.AddUserMessage(content)

	if s.mcpInstructions != "" {
		s.conv.AddSystemReminder(s.mcpInstructions)
		s.mcpInstructions = ""
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.cancelStream = cancel
	s.agentCh = s.ag.Run(ctx, s.conv)

	askDone := make(chan struct{})
	go s.listenForAskUser(askDone)
	s.consumeAgentEvents()
	close(askDone)

	s.streaming = false
	s.cancelStream = nil
	s.agentCh = nil
}

func (s *Server) buildCommandList() []map[string]string {
	var list []map[string]string
	for _, cmd := range s.cmdRegistry.ListCommands() {
		list = append(list, map[string]string{
			"name":        cmd.Name,
			"description": cmd.Description,
		})
	}
	return list
}

func (s *Server) handleSlashCommand(input string) {
	defer func() {
		if r := recover(); r != nil {
			s.send(wsMessage{Type: "error", Data: map[string]string{
				"message": fmt.Sprintf("Command panic: %v", r),
			}})
		}
	}()

	name, args := commands.Parse(input)
	if name == "" {
		return
	}

	cmd := s.cmdRegistry.Find(name)
	if cmd == nil {
		s.send(wsMessage{Type: "error", Data: map[string]string{
			"message": fmt.Sprintf("Unknown command: /%s — type /help to see available commands", name),
		}})
		s.send(wsMessage{Type: "command_done", Data: nil})
		return
	}

	if args == "" && cmd.ArgPrompt != "" {
		s.send(wsMessage{Type: "system", Data: map[string]string{"message": cmd.ArgPrompt}})
		s.send(wsMessage{Type: "command_done", Data: nil})
		return
	}

	ctx := s.buildCommandContext(args)

	switch cmd.Type {
	case commands.TypeLocal:
		if cmd.Handler != nil {
			result := cmd.Handler(ctx)
			s.send(wsMessage{Type: "system", Data: map[string]string{"message": result}})
		}
		s.send(wsMessage{Type: "command_done", Data: nil})

	case commands.TypeLocalUI:
		switch name {
		case "clear":
			s.conv = conversation.NewManager()
			if s.ag != nil {
				s.ag.ClearActiveSkills()
				s.ag.SetToolFilter(nil)
			}
			s.send(wsMessage{Type: "clear", Data: nil})

		case "compact":
			s.handleCompact()
			return // compact manages its own streaming state

		case "plan":
			s.handlePlan(args)
			if args != "" {
				return // plan with arguments goes through the agent flow
			}

		case "resume":
			s.handleResume(args)
			return // resume requires interaction or direct restoration

		case "rewind":
			s.send(wsMessage{Type: "system", Data: map[string]string{
				"message": "Rewind is not yet supported in remote mode.",
			}})
		}
		s.send(wsMessage{Type: "command_done", Data: nil})

	case commands.TypePrompt:
		if cmd.Handler == nil {
			return
		}
		prompt := cmd.Handler(ctx)
		displayText := "/" + name
		if args != "" {
			displayText += " " + args
		}
		// TypePrompt commands generate prompts injected into the agent
		s.streaming = true
		wd, _ := os.Getwd()
		session.SaveMessage(wd, s.sessionID, session.Message{Role: "user", Content: displayText, Ts: time.Now().Unix()})
		s.conv.AddUserMessage(prompt)

		if s.mcpInstructions != "" {
			s.conv.AddSystemReminder(s.mcpInstructions)
			s.mcpInstructions = ""
		}

		c, cancel := context.WithCancel(context.Background())
		s.cancelStream = cancel
		s.agentCh = s.ag.Run(c, s.conv)

		askDone := make(chan struct{})
		go s.listenForAskUser(askDone)
		s.consumeAgentEvents()
		close(askDone)

		s.streaming = false
		s.cancelStream = nil
		s.agentCh = nil
	}
}

func (s *Server) buildCommandContext(args string) *commands.Context {
	wd, _ := os.Getwd()
	return &commands.Context{
		Args:       args,
		TokenCount: func() (int, int) { return 0, 0 },
		PermissionMode: func() string {
			if s.ag != nil && s.ag.Checker != nil {
				return string(s.ag.Checker.Mode)
			}
			return "default"
		},
		SetPermissionMode: func(mode string) error { return nil },
		ToolCount:         func() int { return len(s.registry.ListTools()) },
		SessionInfo: func() string {
			return fmt.Sprintf("Session: %s\nCWD: %s", s.sessionID, wd)
		},
		SkillList: func() []commands.SkillInfo {
			if s.skillCatalog == nil {
				return nil
			}
			var list []commands.SkillInfo
			for _, meta := range s.skillCatalog.List() {
				list = append(list, commands.SkillInfo{
					Name:        meta.Name,
					Description: meta.Description,
				})
			}
			return list
		},
		MCPInfo: func() string {
			if s.mcpMgr == nil {
				return ""
			}
			return "MCP connected"
		},
		WorkDir: wd,
		Model:   s.providers[0].Model,
	}
}

func (s *Server) handleCompact() {
	if s.client == nil || s.conv == nil {
		s.send(wsMessage{Type: "error", Data: map[string]string{"message": "Compact requires an active provider."}})
		s.send(wsMessage{Type: "command_done", Data: nil})
		return
	}
	s.send(wsMessage{Type: "system", Data: map[string]string{"message": "Compacting conversation…"}})
	wd, _ := os.Getwd()
	window := s.providers[0].GetContextWindow()
	var recovery *compact.RecoveryState
	var schemas []map[string]any
	if s.ag != nil {
		recovery = s.ag.RecoveryState
		schemas = s.ag.Registry.GetAllSchemas(s.ag.Protocol)
	}
	msg, err := compact.ForceCompact(context.Background(), s.conv, s.client, wd, s.sessionID, window, recovery, schemas)
	if err != nil {
		s.send(wsMessage{Type: "error", Data: map[string]string{"message": err.Error()}})
	} else {
		s.send(wsMessage{Type: "system", Data: map[string]string{"message": "⟳ " + msg}})
	}
	s.send(wsMessage{Type: "command_done", Data: nil})
}

func (s *Server) handlePlan(args string) {
	wd, _ := os.Getwd()
	if s.ag == nil || s.ag.Checker == nil {
		s.send(wsMessage{Type: "error", Data: map[string]string{"message": "Agent not initialized."}})
		return
	}
	s.ag.Checker.Mode = permissions.ModePlan
	planPath := plan_file.GetOrCreatePlanPath(wd)
	s.ag.Checker.PlanFilePath = planPath
	s.send(wsMessage{Type: "system", Data: map[string]string{
		"message": fmt.Sprintf("Entered Plan mode. Plan file: %s\nExplore the codebase and design your approach.", planPath),
	}})

	if args != "" {
		// Send directly to agent with arguments
		s.streaming = true
		session.SaveMessage(wd, s.sessionID, session.Message{Role: "user", Content: "/plan " + args, Ts: time.Now().Unix()})
		s.conv.AddUserMessage(args)
		ctx, cancel := context.WithCancel(context.Background())
		s.cancelStream = cancel
		s.agentCh = s.ag.Run(ctx, s.conv)
		askDone := make(chan struct{})
		go s.listenForAskUser(askDone)
		s.consumeAgentEvents()
		close(askDone)
		s.streaming = false
		s.cancelStream = nil
		s.agentCh = nil
	}
}

func (s *Server) handleResume(args string) {
	wd, _ := os.Getwd()
	sessions := session.ListSessions(wd)

	if args == "" {
		// No arguments, list available sessions
		if len(sessions) == 0 {
			s.send(wsMessage{Type: "system", Data: map[string]string{"message": "No previous sessions found."}})
			s.send(wsMessage{Type: "command_done", Data: nil})
			return
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Available sessions (%d):\n\n", len(sessions))
		for i, sess := range sessions {
			if i >= 20 {
				fmt.Fprintf(&sb, "  ... and %d more\n", len(sessions)-20)
				break
			}
			first := sess.FirstMessage
			if len(first) > 60 {
				first = first[:60] + "..."
			}
			fmt.Fprintf(&sb, "  %d. [%s] %s (%d msgs)\n", i+1, sess.ID, first, sess.MessageCount)
		}
		sb.WriteString("\nUsage: /resume <number> or /resume <session-id>")
		s.send(wsMessage{Type: "system", Data: map[string]string{"message": sb.String()}})
		s.send(wsMessage{Type: "command_done", Data: nil})
		return
	}

	// With arguments, restore the specified session directly
	targetID := strings.TrimSpace(args)
	var idx int
	if n, _ := fmt.Sscanf(targetID, "%d", &idx); n == 1 && idx >= 1 && idx <= len(sessions) {
		targetID = sessions[idx-1].ID
	}

	msgs := session.LoadSession(wd, targetID)
	if len(msgs) == 0 {
		s.send(wsMessage{Type: "error", Data: map[string]string{
			"message": fmt.Sprintf("Session '%s' not found or empty.", targetID),
		}})
		s.send(wsMessage{Type: "command_done", Data: nil})
		return
	}

	// Rebuild the conversation
	s.conv = conversation.NewManager()
	s.sessionID = targetID
	if s.ag != nil {
		s.ag.SetSessionID(s.sessionID)
	}

	boundary, after, compacted := session.FindLastCompactBoundary(msgs)
	var replay []session.Message
	if compacted {
		resumeSummary := "This session continues from a previous conversation that was compacted due to context size limits. Below is a summary of the earlier discussion:\n\n" + boundary.Summary
		if len(boundary.Keep) > 0 {
			resumeSummary += "\n\nRecent messages have been preserved as-is."
		}
		replay = append(replay, session.Message{Role: "user", Content: resumeSummary})
		for _, k := range boundary.Keep {
			replay = append(replay, session.Message{Role: k.Role, Content: k.Content})
		}
		replay = append(replay, after...)
	} else {
		replay = msgs
	}

	// Clear old UI and replay messages
	s.send(wsMessage{Type: "clear", Data: nil})
	for _, msg := range replay {
		switch msg.Role {
		case "user":
			s.conv.AddUserMessage(msg.Content)
			s.send(wsMessage{Type: "replay_user", Data: map[string]string{"content": msg.Content}})
		case "assistant":
			s.conv.AddAssistantMessage(msg.Content)
			s.send(wsMessage{Type: "replay_assistant", Data: map[string]string{"content": msg.Content}})
		}
	}

	restored := fmt.Sprintf("Session %s restored (%d messages).", targetID, len(replay))
	if compacted {
		restored = fmt.Sprintf("Session %s restored from compacted state (summary + %d kept + %d newer).",
			targetID, len(boundary.Keep), len(after))
	}
	s.send(wsMessage{Type: "system", Data: map[string]string{"message": restored}})
	s.send(wsMessage{Type: "command_done", Data: nil})
}

func (s *Server) consumeAgentEvents() {
	streamBuf := ""
	startTime := time.Now()

	for ev := range s.agentCh {
		switch e := ev.(type) {
		case agent.StreamText:
			streamBuf += e.Text
			s.send(wsMessage{Type: "stream_text", Data: map[string]string{"text": e.Text}})

		case agent.ThinkingText:
			s.send(wsMessage{Type: "thinking_text", Data: map[string]string{"text": e.Text}})

		case agent.ToolUseEvent:
			s.send(wsMessage{Type: "tool_use", Data: map[string]any{
				"toolId":   e.ToolID,
				"toolName": e.ToolName,
				"args":     e.Args,
			}})

		case agent.ToolResultEvent:
			if streamBuf != "" {
				s.send(wsMessage{Type: "stream_end", Data: map[string]string{"text": streamBuf}})
				streamBuf = ""
			}
			s.send(wsMessage{Type: "tool_result", Data: map[string]any{
				"toolId":   e.ToolID,
				"toolName": e.ToolName,
				"output":   e.Output,
				"isError":  e.IsError,
				"elapsed":  e.Elapsed.Seconds(),
			}})

		case agent.PermissionRequestEvent:
			id := fmt.Sprintf("perm_%d", time.Now().UnixNano())
			s.pendingPermMu.Lock()
			s.pendingPerms[id] = e.ResponseCh
			s.pendingPermMu.Unlock()
			s.send(wsMessage{Type: "permission_request", Data: map[string]string{
				"id":          id,
				"toolName":    e.ToolName,
				"description": e.Desc,
			}})

		case agent.AskUserQuestionEvent:
			id := fmt.Sprintf("ask_%d", time.Now().UnixNano())
			respCh := make(chan tools.QuestionResponse, 1)
			s.pendingAskMu.Lock()
			s.pendingAsks[id] = respCh
			s.pendingAskMu.Unlock()
			s.send(wsMessage{Type: "ask_user", Data: map[string]any{
				"id":        id,
				"questions": e.Questions,
			}})
			go func() {
				resp := <-respCh
				e.ResponseCh <- resp.Answers
			}()

		case agent.TurnComplete:
			if streamBuf != "" {
				s.send(wsMessage{Type: "stream_end", Data: map[string]string{"text": streamBuf}})
				streamBuf = ""
			}
			s.send(wsMessage{Type: "turn_complete", Data: map[string]int{"turn": e.Turn}})

		case agent.LoopComplete:
			if streamBuf != "" {
				wd, _ := os.Getwd()
				session.SaveMessage(wd, s.sessionID, session.Message{Role: "assistant", Content: streamBuf, Ts: time.Now().Unix()})
				s.send(wsMessage{Type: "stream_end", Data: map[string]string{"text": streamBuf}})
				streamBuf = ""
			}
			elapsed := time.Since(startTime).Seconds()
			s.send(wsMessage{Type: "loop_complete", Data: map[string]any{
				"totalTurns": e.TotalTurns,
				"elapsed":    elapsed,
			}})

		case agent.UsageEvent:
			s.send(wsMessage{Type: "usage", Data: map[string]int{
				"inputTokens":  e.InputTokens,
				"outputTokens": e.OutputTokens,
			}})

		case agent.ErrorEvent:
			s.send(wsMessage{Type: "error", Data: map[string]string{"message": e.Message}})

		case agent.CompactEvent:
			s.send(wsMessage{Type: "compact", Data: map[string]string{"message": e.Message}})

		case agent.RetryEvent:
			s.send(wsMessage{Type: "retry", Data: map[string]any{
				"reason": e.Reason,
				"waitMs": e.Wait.Milliseconds(),
			}})
		}
	}
}

func (s *Server) listenForAskUser(done <-chan struct{}) {
	for {
		select {
		case <-done:
			return
		case req, ok := <-s.askUserCh:
			if !ok {
				return
			}
			id := fmt.Sprintf("ask_%d", time.Now().UnixNano())
			respCh := make(chan tools.QuestionResponse, 1)
			s.pendingAskMu.Lock()
			s.pendingAsks[id] = respCh
			s.pendingAskMu.Unlock()
			s.send(wsMessage{Type: "ask_user", Data: map[string]any{
				"id":        id,
				"questions": req.Questions,
			}})
			resp := <-respCh
			req.ResponseCh <- resp
		}
	}
}

func (s *Server) handlePermissionResponse(data permResponseData) {
	s.pendingPermMu.Lock()
	ch, ok := s.pendingPerms[data.ID]
	if ok {
		delete(s.pendingPerms, data.ID)
	}
	s.pendingPermMu.Unlock()

	if !ok {
		return
	}

	var resp agent.PermissionResponse
	switch data.Response {
	case "allow":
		resp = agent.PermAllow
	case "deny":
		resp = agent.PermDeny
	case "allowAlways":
		resp = agent.PermAllowAlways
	default:
		resp = agent.PermDeny
	}
	ch <- resp
}

func (s *Server) handleAskUserResponse(data askUserResponseData) {
	s.pendingAskMu.Lock()
	ch, ok := s.pendingAsks[data.ID]
	if ok {
		delete(s.pendingAsks, data.ID)
	}
	s.pendingAskMu.Unlock()

	if !ok {
		return
	}

	ch <- tools.QuestionResponse{Answers: data.Answers}
}

func (s *Server) send(msg wsMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.conns) == 0 {
		return
	}
	data, _ := json.Marshal(msg)
	for conn := range s.conns {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("[ws] write error: type=%s err=%v", msg.Type, err)
		}
	}
}

func (s *Server) wireSkillsToAgent(_ string) {
	if s.skillCatalog == nil || s.ag == nil {
		return
	}
	for _, meta := range s.skillCatalog.List() {
		if skill := s.skillCatalog.Get(meta.Name); skill != nil && skill.IsDirectory {
			_, _ = skills.RegisterDirectoryTools(skill, s.registry)
		}
	}
	s.registry.Register(&skills.LoadSkillTool{
		Catalog: s.skillCatalog,
		Host:    s,
	})
}

// SkillHost interface implementation

func (s *Server) ActivateSkill(name, body string) {
	if s.ag != nil {
		s.ag.ActivateSkill(name, body)
	}
}

func (s *Server) SetToolFilter(allow func(name string) bool) {
	if s.ag != nil {
		s.ag.ToolNameFilter = allow
	}
}

func (s *Server) ToolRegistry() *tools.Registry {
	return s.registry
}

// Helper functions

func loadCustomInstructions(wd string) string {
	paths := []string{
		filepath.Join(wd, ".larky", "instructions.md"),
		filepath.Join(wd, "CLAUDE.md"),
	}
	var parts []string
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			parts = append(parts, string(data))
		}
	}
	return strings.Join(parts, "\n\n")
}

func buildSkillSection(catalog *skills.Catalog, wd string) string {
	if catalog == nil {
		return ""
	}
	metas := catalog.List()
	if len(metas) == 0 {
		return ""
	}
	skillsDir := filepath.Join(wd, ".larky", "skills")
	var sb strings.Builder
	sb.WriteString("## Available Skills\n\n")
	fmt.Fprintf(&sb, "Skills are installed at: %s\n", skillsDir)
	sb.WriteString("When creating new skills, always place them under this directory as <skill-name>/SKILL.md.\n\n")
	for _, meta := range metas {
		desc := meta.Description
		if len(desc) > 200 {
			desc = desc[:200] + "..."
		}
		fmt.Fprintf(&sb, "- /%s: %s\n", meta.Name, desc)
	}
	return sb.String()
}

func installMemExtractor(ag *agent.Agent, wd, protocol string, client llm.Client, registry *tools.Registry, conv *conversation.Manager) *extractor.Extractor {
	extr := extractor.InitExtractMemories(extractor.Deps{
		MemoryDir:     memory.GetAutoMemPath(wd),
		UserMemoryDir: memory.GetUserAutoMemPath(),
		ProjectRoot:   wd,
		Client:        client,
		ToolRegistry:  registry,
		Protocol:      protocol,
		Conversation:  conv,
		AppendSystem:  func(s string) { conv.AddSystemReminder(s) },
	})
	ag.OnLoopComplete = func(_ *conversation.Manager) {
		_ = extr.Execute(context.Background())
	}
	return extr
}

func newAgentHookRunner(client llm.Client) func(prompt string, ctx hooks.HookContext) (string, error) {
	return func(p string, _ hooks.HookContext) (string, error) {
		c, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		conv := conversation.NewManager()
		conv.AddUserMessage(p)
		events, errs := client.Stream(c, conv, nil)
		var text string
		for ev := range events {
			if td, ok := ev.(llm.TextDelta); ok {
				text += td.Text
			}
		}
		select {
		case err := <-errs:
			if err != nil {
				return "", err
			}
		default:
		}
		return text, nil
	}
}

func mustGetwd() string {
	wd, _ := os.Getwd()
	return wd
}
