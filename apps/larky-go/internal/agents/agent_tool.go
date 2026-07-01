package agents

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"larky/internal/agent"
	"larky/internal/conversation"
	"larky/internal/llm"
	"larky/internal/permissions"
	"larky/internal/teams"
	"larky/internal/toolresult"
	"larky/internal/tools"
	"larky/internal/worktree"
)

// sanitizeSlugSegment replaces any character outside [a-zA-Z0-9._-] with '-' and trims redundant
// separators so the result is safe for a git branch name.
var unsafeSlugChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeSlugSegment(s string) string {
	clean := unsafeSlugChars.ReplaceAllString(s, "-")
	clean = strings.Trim(clean, "-_.")
	if clean == "" {
		clean = "subagent"
	}
	if len(clean) > 40 {
		clean = clean[:40]
	}
	return clean
}

type SubAgentProgress struct {
	AgentDesc string
	AgentType string
	ToolName  string
	ToolArgs  map[string]any
	Elapsed   float64
	IsError   bool
	Done      bool
	ToolCount int
	TotalTime float64
}

const ForkBoilerplateTag = "<fork_boilerplate>"

// ForkAgentType matches FORK_AGENT.agentType from the design TypeScript implementation.
const ForkAgentType = "fork"

// ForkQuerySource matches the value produced by getQuerySourceForAgent for fork children
// (`agent:builtin:${FORK_AGENT.agentType}`). Used as the primary fork-nesting signal; falls back to
// scanning conversation history for ForkBoilerplateTag.
const ForkQuerySource = "agent:builtin:" + ForkAgentType

type AgentTool struct {
	Client        llm.Client
	ModelResolver func(string) (llm.Client, error)
	Registry      *tools.Registry
	Protocol      string
	TaskMgr       *TaskManager
	ProgressCh    chan<- SubAgentProgress
	Loader        *AgentLoader
	Conversation  *conversation.Manager // parent conversation, needed for Fork
	TeamMgr       *teams.TeamManager    // optional, enables team_name parameter

	// ParentChecker is the parent agent's permission checker. The Sandbox and RuleEngine are reused;
	// only Mode is overridden when the sub-agent definition / call sets a different permissionMode.
	// Optional — when nil, sub-agents inherit no checker (early bootstrap / tests).
	ParentChecker *permissions.Checker

	// ParentReplacementState is the parent agent's tool-result decision log.
	// Fork children Clone() it at construction so they share frozen
	// decisions on tool_use_ids inherited from the parent (necessary for
	// prompt-cache prefix stability across parent/child). Non-fork
	// sub-agents (subagent_type=*) start with a fresh state — they have no
	// shared history, so they have no shared cache prefix to preserve.
	ParentReplacementState *toolresult.ContentReplacementState

	// QuerySource identifies the spawning agent for nested-fork detection. Empty for the main thread;
	// set to ForkQuerySource (or "agent:builtin:<type>") when the AgentTool instance lives inside a
	// spawned sub-agent. Compaction-resistant — survives even when the fork boilerplate gets
	// summarized out of conversation history.
	QuerySource string
}

func (t *AgentTool) Name() string                 { return "Agent" }
func (t *AgentTool) Category() tools.ToolCategory { return tools.CategoryCommand }

func (t *AgentTool) Description() string {
	desc := `Launch a sub-agent to handle a complex task. Each sub-agent runs independently with its own context. The sub-agent cannot see the current conversation.

This is ONE tool with multiple roles. Roles are NOT separate tools — you pick one by passing its name in the "subagent_type" parameter. Do not search for a tool named after a role; call THIS tool ("Agent") and set "subagent_type".

Available roles for the "subagent_type" parameter:`

	if t.Loader != nil {
		for _, name := range t.Loader.ListNames() {
			def := t.Loader.Get(name)
			desc += "\n- " + name + ": " + def.WhenToUse
		}
	} else {
		desc += "\n- general-purpose: Full tool access for multi-step tasks (default)"
		desc += "\n- plan: Read-only tools for designing implementation plans"
		desc += "\n- explore: Read-only search agent for locating code"
	}

	desc += `

Example call shape:
{
  "name": "Agent",
  "input": {
    "subagent_type": "<role from the list above>",
    "description": "Short task label",
    "prompt": "Detailed instructions — the sub-agent has zero prior context"
  }
}

Write a detailed prompt explaining what the sub-agent should do and why — it has no prior context.
When tasks are independent, launch multiple sub-agents in parallel by making multiple Agent tool calls in a single response.`
	return desc
}

func (t *AgentTool) Schema() map[string]any {
	agentTypes := []string{"general-purpose", "plan", "explore"}
	if t.Loader != nil {
		agentTypes = t.Loader.ListNames()
	}

	return map[string]any{
		"name":        t.Name(),
		"description": t.Description(),
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"description": map[string]any{
					"type":        "string",
					"description": "A short (3-5 word) description of the task",
				},
				"prompt": map[string]any{
					"type":        "string",
					"description": "The task for the agent to perform. Be detailed — the agent has no context from this conversation.",
				},
				"subagent_type": map[string]any{
					"type":        "string",
					"enum":        agentTypes,
					"description": "The type of agent to use. If omitted, forks current conversation context.",
				},
				"model": map[string]any{
					"type":        "string",
					"enum":        []string{"sonnet", "opus", "haiku"},
					"description": "Override the model for this agent.",
				},
				"run_in_background": map[string]any{
					"type":        "boolean",
					"description": "Set to true to run the agent in the background.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "Name for the agent, enabling SendMessage communication.",
				},
				"isolation": map[string]any{
					"type":        "string",
					"enum":        []string{"worktree"},
					"description": "Isolation mode. Set to 'worktree' to give the agent its own git worktree so its file edits don't collide with peers or the lead. REQUIRED when spawning two or more teammates in parallel that may write files; STRONGLY RECOMMENDED for any single teammate doing non-trivial file edits while the lead is still working in the same repo. Skip only for read-only tasks (explore/grep/plan) or when you explicitly want the teammate to share your working tree.",
				},
				"team_name": map[string]any{
					"type":        "string",
					"description": "REQUIRED when creating team members. Spawns the agent as a long-running teammate under this team (created via TeamCreate). Unlike regular sub-agents, team members run in their own terminal, persist after the lead returns, and communicate with each other via SendMessage. Without team_name the agent runs as a one-shot sub-agent that blocks and returns inline.",
				},
				"mode": map[string]any{
					"type":        "string",
					"enum":        []string{"default", "acceptEdits", "plan", "bypassPermissions"},
					"description": "Permission mode override for the spawned agent (e.g., 'plan' to require plan approval).",
				},
				"cwd": map[string]any{
					"type":        "string",
					"description": "Absolute path to run the agent in. Overrides the working directory for filesystem and shell operations. Mutually exclusive with isolation: 'worktree'.",
				},
			},
			"required": []string{"description", "prompt"},
		},
	}
}

func (t *AgentTool) selectClient(specModel, overrideModel string) llm.Client {
	model := overrideModel
	if model == "" {
		model = specModel
	}
	if model == "" || model == "inherit" {
		return t.Client
	}
	if t.ModelResolver != nil {
		if c, err := t.ModelResolver(model); err == nil {
			return c
		}
	}
	return t.Client
}

func (t *AgentTool) Execute(ctx context.Context, args map[string]any) tools.ToolResult {
	description, _ := args["description"].(string)
	prompt, _ := args["prompt"].(string)
	if description == "" || prompt == "" {
		return tools.ToolResult{Output: "Error: description and prompt are required", IsError: true}
	}

	subagentType, _ := args["subagent_type"].(string)
	modelOverride, _ := args["model"].(string)
	runInBackground, _ := args["run_in_background"].(bool)
	agentName, _ := args["name"].(string)
	teamName, _ := args["team_name"].(string)
	modeOverride, _ := args["mode"].(string)
	cwdOverride, _ := args["cwd"].(string)
	isolation, _ := args["isolation"].(string)

	// cwd and isolation: "worktree" are mutually exclusive.
	if cwdOverride != "" && isolation == "worktree" {
		return tools.ToolResult{
			Output:  "Error: cwd and isolation: 'worktree' are mutually exclusive",
			IsError: true,
		}
	}

	if modeOverride != "" && !validPermissionModes[modeOverride] {
		return tools.ToolResult{
			Output:  fmt.Sprintf("Error: invalid mode '%s'. Valid: default, acceptEdits, plan, bypassPermissions", modeOverride),
			IsError: true,
		}
	}

	// Team-member path: an explicit team_name turns this spawn into a long-running teammate under that
	// team's backend. The lead gets control back as soon as the teammate boots; further coordination
	// flows through SendMessage / mailbox notifications.
	if teamName != "" && t.TeamMgr != nil {
		return t.runAsTeammate(ctx, teamName, agentName, description, prompt, modelOverride, subagentType, isolation)
	}

	// Fork path: no subagent_type specified.
	if subagentType == "" {
		return t.runFork(ctx, description, prompt, modelOverride, agentName)
	}

	// Definition path: resolve spec from loader or builtins.
	var spec SubAgentSpec
	if t.Loader != nil {
		def := t.Loader.Get(subagentType)
		if def == nil {
			return tools.ToolResult{
				Output:  fmt.Sprintf("Error: unknown agent type '%s'. Available: %s", subagentType, strings.Join(t.Loader.ListNames(), ", ")),
				IsError: true,
			}
		}
		spec = def.ToSpec()
	} else {
		s, ok := BuiltinSpecs[subagentType]
		if !ok {
			return tools.ToolResult{
				Output:  fmt.Sprintf("Error: unknown agent type '%s'. Available: general-purpose, plan, explore", subagentType),
				IsError: true,
			}
		}
		spec = s
	}

	// Per-call mode override beats the definition's permissionMode.
	if modeOverride != "" {
		spec.PermissionMode = modeOverride
	}

	// Definition-level `background: true` forces the spawn to run async, matching the
	// `run_in_background || selectedAgent.background` gating.
	if runInBackground || spec.Background {
		return t.runAsync(ctx, spec, description, prompt, modelOverride)
	}
	return t.runSync(ctx, spec, description, prompt, modelOverride, isolation, cwdOverride)
}

func (t *AgentTool) runSync(ctx context.Context, spec SubAgentSpec, description, prompt, modelOverride, isolation, cwdOverride string) tools.ToolResult {
	subRegistry := FilterToolsForAgent(t.Registry, spec.Tools, spec.DisallowedTools, false)
	client := t.selectClient(spec.Model, modelOverride)

	subAgent := agent.New(client, subRegistry, t.Protocol)
	subAgent.Checker = deriveSubAgentChecker(t.ParentChecker, spec.PermissionMode)
	if spec.MaxTurns > 0 {
		subAgent.MaxIterations = spec.MaxTurns
	} else {
		subAgent.MaxIterations = 200
	}

	// Worktree isolation: create an isolated worktree for the sub-agent.
	var wtResult *worktree.AgentWorktreeResult
	if isolation == "worktree" {
		slug := generateAgentSlug(description)
		var err error
		wtResult, err = worktree.CreateAgentWorktree(ctx, slug)
		if err != nil {
			return tools.ToolResult{
				Output:  fmt.Sprintf("Error creating agent worktree: %s", err),
				IsError: true,
			}
		}
		subAgent.WorkDir = wtResult.WorktreePath

		// Inject worktree notice into the prompt.
		parentCwd, _ := os.Getwd()
		notice := worktree.BuildWorktreeNotice(parentCwd, wtResult.WorktreePath)
		prompt = notice + "\n\n" + prompt
	} else if cwdOverride != "" {
		subAgent.WorkDir = cwdOverride
	}

	conv := conversation.NewManager()
	if spec.SystemPromptOverride != "" {
		conv.AddSystemReminder(spec.SystemPromptOverride)
	}
	// initialPrompt is prepended to the first user turn.
	if spec.InitialPrompt != "" {
		conv.AddUserMessage(spec.InitialPrompt)
	}
	conv.AddUserMessage(prompt)

	start := time.Now()
	var output strings.Builder
	toolCount := 0
	ch := subAgent.Run(ctx, conv)

	for ev := range ch {
		switch e := ev.(type) {
		case agent.StreamText:
			output.WriteString(e.Text)
		case agent.PermissionRequestEvent:
			// Sub-agents are headless — there's no UI to prompt. Auto-deny keeps the sub-agent's
			// executeSingleTool unblocked instead of stalling on respCh forever. respCh has buffer=1, so
			// this send is non-blocking.
			e.ResponseCh <- agent.PermDeny
		case agent.ToolResultEvent:
			toolCount++
			emitProgress(t.ProgressCh, ctx, SubAgentProgress{
				AgentDesc: description,
				AgentType: spec.Name,
				ToolName:  e.ToolName,
				ToolArgs:  map[string]any{"_summary": e.Output},
				Elapsed:   e.Elapsed.Seconds(),
				IsError:   e.IsError,
			})
		case agent.ErrorEvent:
			emitProgress(t.ProgressCh, ctx, SubAgentProgress{
				AgentDesc: description,
				AgentType: spec.Name,
				Done:      true,
				ToolCount: toolCount,
				TotalTime: time.Since(start).Seconds(),
				IsError:   true,
			})
			return tools.ToolResult{
				Output:  fmt.Sprintf("Agent failed: %s", e.Message),
				IsError: true,
			}
		}
	}

	elapsed := time.Since(start)

	emitProgress(t.ProgressCh, ctx, SubAgentProgress{
		AgentDesc: description,
		AgentType: spec.Name,
		Done:      true,
		ToolCount: toolCount,
		TotalTime: elapsed.Seconds(),
	})

	result := output.String()
	if result == "" {
		result = "(agent produced no output)"
	}

	// Worktree cleanup: if the sub-agent ran in an isolated worktree, auto-remove if clean, preserve
	// if dirty.
	if wtResult != nil {
		if worktree.HasWorktreeChanges(ctx, wtResult.WorktreePath, wtResult.HeadCommit) {
			result += fmt.Sprintf("\n\nWorktree kept at %s (branch %s) — has uncommitted changes or new commits.",
				wtResult.WorktreePath, wtResult.WorktreeBranch)
		} else {
			worktree.RemoveAgentWorktree(ctx, wtResult.WorktreePath, wtResult.WorktreeBranch, wtResult.GitRoot)
		}
	}

	return tools.ToolResult{
		Output: fmt.Sprintf("Agent \"%s\" completed in %s.\n\n%s", description, elapsed.Round(time.Millisecond), result),
	}
}

func (t *AgentTool) runFork(ctx context.Context, description, prompt, modelOverride, agentName string) tools.ToolResult {
	if t.Conversation == nil {
		return tools.ToolResult{Output: "Error: fork requires parent conversation context", IsError: true}
	}

	// Nested fork guard, two layers:
	// (1) Primary: querySource — set on the AgentTool instance when it's constructed inside a fork
	//     child. Compaction-resistant; catches the case where conversation history was rewritten or
	//     summarized.
	// (2) Fallback: message scan for ForkBoilerplateTag.
	if t.QuerySource == ForkQuerySource {
		return tools.ToolResult{
			Output:  "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
			IsError: true,
		}
	}
	for _, msg := range t.Conversation.GetMessages() {
		if strings.Contains(msg.Content, ForkBoilerplateTag) {
			return tools.ToolResult{
				Output:  "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
				IsError: true,
			}
		}
	}

	// Build forked conversation: copy parent messages + patch incomplete tool_use + append task.
	forkedConv := buildForkedConversation(t.Conversation, prompt)

	client := t.selectClient("", modelOverride)
	// Fork inherits the parent's exact tool pool to keep API request prefixes byte-identical for
	// prompt cache hits (matches FORK_AGENT.tools=['*'] + useExactTools=true). The Agent tool gets
	// cloned with QuerySource=ForkQuerySource so any nested fork attempt is rejected by the primary
	// check in runFork.
	subRegistry := cloneRegistryForFork(t.Registry)

	subAgent := agent.New(client, subRegistry, t.Protocol)
	subAgent.Checker = t.ParentChecker // fork inherits parent's permission state verbatim
	subAgent.MaxIterations = 200
	// Fork inherits the parent's tool-result decision log so any tool_use_id
	// already seen in the shared history makes the same decision in the
	// child — necessary to keep the prompt-cache prefix byte-identical
	// across parent and child.
	if t.ParentReplacementState != nil {
		subAgent.ReplacementState = t.ParentReplacementState.Clone()
	}

	// Fork always runs in background.
	taskName := "fork"
	if agentName != "" {
		taskName = agentName
	}
	taskID := t.TaskMgr.CreateTask(taskName + ": " + truncate(prompt, 50))
	forkCtx, cancel := context.WithCancel(ctx)
	t.TaskMgr.SetRunning(taskID, cancel)

	go func() {
		var output string
		ch := subAgent.Run(forkCtx, forkedConv)
		for ev := range ch {
			switch e := ev.(type) {
			case agent.StreamText:
				output += e.Text
			case agent.PermissionRequestEvent:
				// Headless: auto-deny so the fork doesn't stall on respCh.
				e.ResponseCh <- agent.PermDeny
			case agent.ErrorEvent:
				t.TaskMgr.SetFailed(taskID, e.Message)
				return
			}
		}
		t.TaskMgr.SetCompleted(taskID, output)
	}()

	return tools.ToolResult{
		Output: fmt.Sprintf(
			"Forked agent \"%s\" launched in background (task %s). Results will arrive via task-notification.",
			description, taskID,
		),
	}
}

// emitProgress sends a SubAgentProgress event without ever blocking the caller. If the consumer
// (TUI) is behind, the event is dropped — progress is best-effort UI feedback, not load-bearing
// state. Blocking sends here caused sub-agent loops to deadlock when ProgressCh's buffer filled up,
// which in turn prevented ESC / ctx cancel from ever taking effect because the sub-agent was stuck
// in this send rather than at a ctx-aware point.
func emitProgress(ch chan<- SubAgentProgress, ctx context.Context, p SubAgentProgress) {
	if ch == nil {
		return
	}
	select {
	case ch <- p:
	case <-ctx.Done():
	default:
		// Consumer is behind. Drop the event rather than stalling the sub-agent's event loop.
	}
}

// deriveSubAgentChecker threads a sub-agent's permissionMode through to the spawned agent: `mode`
// overrides the agent definition's permissionMode, which then feeds the sub-agent's
// ToolPermissionContext. The Sandbox and RuleEngine are shared — we only swap the Mode so the
// sub-agent's tool calls hit a different decision matrix without diverging permission state.
//
// Returns the parent checker unchanged when no override is requested.
func deriveSubAgentChecker(parent *permissions.Checker, modeOverride string) *permissions.Checker {
	if parent == nil {
		return nil
	}
	if modeOverride == "" || permissions.PermissionMode(modeOverride) == parent.Mode {
		return parent
	}
	return permissions.NewChecker(parent.Sandbox, parent.RuleEngine, permissions.PermissionMode(modeOverride))
}

// cloneRegistryForFork returns a registry that copies the parent verbatim except that any
// *AgentTool instance is replaced with a shallow copy whose QuerySource is set to ForkQuerySource.
// This is the local equivalent of useExactTools=true plus getQuerySourceForAgent: the fork child
// sees the same wire-level tool definitions as its parent (so prompt cache hits) but a nested fork
// attempt is caught at call time by the QuerySource check in runFork.
func cloneRegistryForFork(reg *tools.Registry) *tools.Registry {
	forked := tools.NewRegistry()
	for _, tool := range reg.ListTools() {
		if at, ok := tool.(*AgentTool); ok {
			clone := *at
			clone.QuerySource = ForkQuerySource
			forked.Register(&clone)
			continue
		}
		forked.Register(tool)
	}
	return forked
}

const forkBoilerplate = ForkBoilerplateTag + `
You are a forked worker process. You are NOT the main agent.
Rules (non-negotiable):
1. Do NOT fork again.
2. Do NOT converse, ask questions, or request confirmation.
3. Use tools directly: read files, search code, make changes.
4. Stay strictly within your assigned task scope.
5. Final report must be under 500 characters, starting with "Scope:".
` + "</fork_boilerplate>"

func buildForkedConversation(parent *conversation.Manager, task string) *conversation.Manager {
	forked := conversation.NewManager()
	msgs := parent.GetMessages()

	// Byte-exact replay: preserve thinking blocks alongside tool_use so the API request prefix matches
	// the parent's exactly (cf. "keeping all content blocks (thinking, text, and every tool_use)").
	// Missing thinking blocks would change the assistant message shape and bust the prompt cache.
	for _, msg := range msgs {
		if len(msg.ToolUses) > 0 && len(msg.ToolResults) == 0 {
			forked.AddAssistantFull(msg.Content, msg.ThinkingBlocks, msg.ToolUses)
			var placeholders []conversation.ToolResultBlock
			for _, tu := range msg.ToolUses {
				placeholders = append(placeholders, conversation.ToolResultBlock{
					ToolUseID: tu.ToolUseID,
					Content:   "(tool execution interrupted by fork)",
					IsError:   false,
				})
			}
			forked.AddToolResultsMessage(placeholders)
		} else if len(msg.ToolUses) > 0 {
			forked.AddAssistantFull(msg.Content, msg.ThinkingBlocks, msg.ToolUses)
		} else if len(msg.ToolResults) > 0 {
			forked.AddToolResultsMessage(msg.ToolResults)
		} else if msg.Role == "assistant" {
			if len(msg.ThinkingBlocks) > 0 {
				forked.AddAssistantFull(msg.Content, msg.ThinkingBlocks, nil)
			} else {
				forked.AddAssistantMessage(msg.Content)
			}
		} else {
			forked.AddUserMessage(msg.Content)
		}
	}

	// Append fork boilerplate + task as user message.
	forked.AddUserMessage(forkBoilerplate + "\n\nYour task:\n" + task)
	return forked
}

func (t *AgentTool) runAsync(ctx context.Context, spec SubAgentSpec, description, prompt, modelOverride string) tools.ToolResult {
	client := t.selectClient(spec.Model, modelOverride)
	taskID := SpawnSubAgent(ctx, t.TaskMgr, client, t.Registry, t.Protocol, spec, prompt, t.ParentChecker)

	return tools.ToolResult{
		Output: fmt.Sprintf(
			"Agent \"%s\" launched in background (task %s). You will be notified when it completes.",
			description, taskID,
		),
	}
}

// runAsTeammate registers a long-running team member on an existing Team. Unlike runSync/runAsync,
// this path never blocks the lead on the member's output: the lead always returns immediately and
// coordinates through SendMessage + idle notifications in the team mailbox. The backend (in-process
// / tmux / iTerm) is picked from Team.Mode by teams.SpawnTeammate.
//
// When isolation == "worktree" and a WorktreeMgr is configured, the teammate gets a dedicated git
// worktree so its file edits don't collide with peers' work.
func (t *AgentTool) runAsTeammate(
	ctx context.Context,
	teamName, memberName, description, prompt, modelOverride, subagentType, isolation string,
) tools.ToolResult {
	team := t.TeamMgr.GetTeam(teamName)
	if team == nil {
		return tools.ToolResult{
			Output:  fmt.Sprintf("Error: team '%s' not found. Call TeamCreate first.", teamName),
			IsError: true,
		}
	}

	if memberName == "" {
		memberName = sanitizeSlugSegment(description)
	}
	if _, exists := team.Members[memberName]; exists {
		return tools.ToolResult{
			Output:  fmt.Sprintf("Error: team '%s' already has a member named '%s'", teamName, memberName),
			IsError: true,
		}
	}

	// Resolve spec when subagent_type is set so the teammate respects the same disallow list any other
	// sub-agent of that type would. Without a spec we hand the full registry to the teammate.
	var spec SubAgentSpec
	if subagentType != "" {
		if t.Loader != nil {
			if def := t.Loader.Get(subagentType); def != nil {
				spec = def.ToSpec()
			}
		} else if s, ok := BuiltinSpecs[subagentType]; ok {
			spec = s
		}
	}

	subRegistry := FilterToolsForAgent(t.Registry, spec.Tools, spec.DisallowedTools, false)
	client := t.selectClient(spec.Model, modelOverride)

	var otherMembers []string
	for n := range team.Members {
		otherMembers = append(otherMembers, n)
	}
	addendum := teams.BuildTeammateAddendum(teamName, memberName, otherMembers)

	var workdir string
	if isolation == "worktree" {
		slug := generateAgentSlug(description)
		wtResult, err := worktree.CreateAgentWorktree(ctx, slug)
		if err != nil {
			return tools.ToolResult{
				Output:  fmt.Sprintf("Error creating teammate worktree: %s", err),
				IsError: true,
			}
		}
		workdir = wtResult.WorktreePath
		parentCwd, _ := os.Getwd()
		notice := worktree.BuildWorktreeNotice(parentCwd, wtResult.WorktreePath)
		prompt = notice + "\n\n" + prompt
	}

	result, err := teams.SpawnTeammate(ctx, teams.TeammateSpawnConfig{
		Team:       team,
		MemberName: memberName,
		Task:       prompt,
		Addendum:   addendum,
		Client:     client,
		Registry:   subRegistry,
		Protocol:   t.Protocol,
		Workdir:    workdir,
	})
	if err != nil {
		return tools.ToolResult{
			Output:  fmt.Sprintf("Error spawning teammate: %v", err),
			IsError: true,
		}
	}

	// In-process spawns hand back a live event channel; drain it in the background so the goroutine
	// doesn't block on a full chan. Lead-visible progress flows through the mailbox, not this drain.
	if result.Mode == teams.ModeInProcess && result.EventCh != nil {
		go drainTeammateEvents(memberName, result.EventCh, t.ProgressCh)
	}

	backendHint := string(result.Mode)
	if result.PaneID != "" {
		backendHint += " pane=" + result.PaneID
	}
	if workdir != "" {
		backendHint += " worktree=" + workdir
	}
	return tools.ToolResult{
		Output: fmt.Sprintf(
			"Teammate \"%s\" started on team \"%s\" [%s]. Use SendMessage to talk to it; its idle notifications will arrive as system reminders.",
			memberName, teamName, backendHint,
		),
	}
}

// drainTeammateEvents consumes a teammate's event stream so the producer side never blocks on a
// full channel. Tool/error events are forwarded to ProgressCh when set so the parent UI can show
// activity.
func drainTeammateEvents(name string, ch <-chan agent.AgentEvent, progressCh chan<- SubAgentProgress) {
	for ev := range ch {
		if progressCh == nil {
			continue
		}
		switch e := ev.(type) {
		case agent.ToolResultEvent:
			emitProgress(progressCh, context.Background(), SubAgentProgress{
				AgentDesc: name,
				AgentType: "teammate",
				ToolName:  e.ToolName,
				Elapsed:   e.Elapsed.Seconds(),
				IsError:   e.IsError,
			})
		case agent.ErrorEvent:
			emitProgress(progressCh, context.Background(), SubAgentProgress{
				AgentDesc: name,
				AgentType: "teammate",
				ToolName:  "error",
				IsError:   true,
			})
		}
	}
}

// generateAgentSlug produces a slug matching ^agent-a[0-9a-f]{7}$ for sub-agent worktrees.x.
func generateAgentSlug(description string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "agent-a" + hex.EncodeToString(b)[:7]
}
