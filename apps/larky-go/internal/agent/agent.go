package agent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"larky/internal/compact"
	"larky/internal/conversation"
	"larky/internal/filehistory"
	"larky/internal/hooks"
	"larky/internal/llm"
	"larky/internal/permissions"
	"larky/internal/planfile"
	"larky/internal/prompt"
	"larky/internal/toolresult"
	"larky/internal/tools"
)

const (
	maxTokensCeiling          = 64000
	maxOutputTokensRecoveries = 3
)

type Agent struct {
	Client        llm.Client
	Registry      *tools.Registry
	Protocol      string
	WorkDir       string
	MaxIterations int
	ContextWindow int
	// MaxOutputTokens is the model's max output budget; used by Layer 2 to
	// compute the effective window for the compaction threshold. Zero falls
	// back to the summaryOutputReserve default inside compact.
	MaxOutputTokens int
	Checker         *permissions.Checker
	Hooks           *hooks.Engine
	// SessionID identifies the on-disk session log this agent appends to. When
	// set, Layer 2 compaction writes a compact_boundary record into that session
	// so a later resume can rebuild the compacted state instead of replaying the
	// full pre-compaction transcript. Empty disables boundary persistence (tests,
	// one-shot callers).
	SessionID      string
	NotificationFn func() []string
	// ToolNameFilter, when non-nil, drops any tool whose Name returns false from the schemas sent to
	// the LLM. The filter is consulted at the top of every iteration so callers can flip Coordinator
	// Mode on or off (e.g., when a team is created/torn down) without restarting the agent.
	Instructions   string
	MemoryContent  string
	ToolNameFilter func(name string) bool
	// OnLoopComplete, when non-nil, is invoked fire-and-forget after the agent reaches LoopComplete
	// (final assistant message, no tool calls remaining). Used by ch09 background memory extraction.
	// Replaces the original stopHooks dispatcher; failures are silent and must not block the main
	// loop. The callback receives the live conversation — do not mutate it from another goroutine.
	OnLoopComplete  func(conv *conversation.Manager)
	FileHistory     *filehistory.History
	compactTracking compact.AutoCompactTrackingState
	// ReplacementState carries the per-conversation-thread tool-result
	// decision log across iterations. Lazily created on first Run; forks
	// inherit a Clone() so they share the parent's frozen decisions but do
	// not write back into the parent's maps. Exposed so external code (e.g.
	// AgentTool fork-spawn) can pre-populate from a parent state.
	ReplacementState *toolresult.ContentReplacementState
	// RecoveryState holds the snapshots needed to rebuild working context
	// after Layer 2 collapses the conversation into a summary: most-recent
	// file reads and skill invocations. The struct is concurrency-safe so
	// the streaming executor can write to it from multiple goroutines.
	RecoveryState *compact.RecoveryState
	eventCh       chan AgentEvent
	// activeSkills tracks which Skill SOPs have been activated in this session (name → body).
	// Used by /skills to show what's active and by RecoveryState to survive compaction.
	// The body is injected once into the conversation as a message — NOT re-injected every turn.
	activeSkills map[string]string
}

// ActivateSkill records a skill activation. The body is kept for /skills listing and compaction
// recovery, but is NOT re-injected every turn — it lives in the conversation as a regular message.
func (a *Agent) ActivateSkill(name, body string) {
	if a.activeSkills == nil {
		a.activeSkills = make(map[string]string)
	}
	a.activeSkills[name] = body
}

// ClearActiveSkills drops every pinned SOP. Called by /clear so a fresh conversation doesn't carry
// over SOPs from a prior task. Safe to call when no skills were ever activated.
func (a *Agent) ClearActiveSkills() {
	a.activeSkills = nil
}

// GetActiveSkills returns a copy of the currently-pinned SOPs (name → body). Used by tests and by
// /skills to surface what's active.
func (a *Agent) GetActiveSkills() map[string]string {
	out := make(map[string]string, len(a.activeSkills))
	for k, v := range a.activeSkills {
		out[k] = v
	}
	return out
}

// SetToolFilter installs a tool visibility filter for the current conversation. The filter is
// consulted at the top of every iteration so callers can flip skill-imposed allowedTools on or off
// without restarting the agent. Passing nil clears any previous filter. Implements one half of the
// skills.SkillHost interface.
func (a *Agent) SetToolFilter(allow func(name string) bool) {
	a.ToolNameFilter = allow
}

// ToolRegistry returns the live tool registry. Named ToolRegistry (not just Registry, even though
// that would match the field name) to avoid the method/field collision Go disallows. Matches the
// skills.SkillHost contract.
func (a *Agent) ToolRegistry() *tools.Registry {
	return a.Registry
}

func New(client llm.Client, registry *tools.Registry, protocol string) *Agent {
	wd, _ := os.Getwd()
	return &Agent{
		Client:           client,
		Registry:         registry,
		Protocol:         protocol,
		WorkDir:          wd,
		MaxIterations:    0,
		ContextWindow:    200000,
		ReplacementState: toolresult.New(),
		RecoveryState:    compact.NewRecoveryState(),
	}
}

// SetSessionID wires the on-disk session log id onto the agent so Layer 2
// compaction can persist a compact_boundary record into the same session the TUI
// is appending plain messages to. Called from the TUI right after the agent is
// constructed (and again after a resume switches sessions).
func (a *Agent) SetSessionID(id string) { a.SessionID = id }

// currentToolSchemas builds the schema list the next API call will use,
// honouring any active skill's allowed-tools filter. Shared between the
// recovery attachment (which lists what's still available after compact)
// and the actual Stream call so both views stay consistent.
func (a *Agent) currentToolSchemas() []map[string]any {
	schemas := a.Registry.GetAllSchemas(a.Protocol)
	if a.ToolNameFilter == nil {
		return schemas
	}
	allow := func(name string) bool {
		if t := a.Registry.Get(name); t != nil && tools.IsSystemTool(t) {
			return true
		}
		return a.ToolNameFilter(name)
	}
	return filterSchemasByName(schemas, allow)
}

func (a *Agent) Run(ctx context.Context, conv *conversation.Manager) <-chan AgentEvent {
	ch := make(chan AgentEvent, 32)

	go func() {
		defer close(ch)
		defer a.emitHook(hooks.EventSessionEnd, "", nil)

		a.emitHook(hooks.EventSessionStart, "", nil)

		conv.InjectLongTermMemory(a.Instructions, a.MemoryContent)

		var totalInput, totalOutput int
		consecutiveUnknown := 0
		maxTokensEscalated := false
		outputRecoveries := 0
		// usageAnchor pins the last real API usage to the conversation length at
		// the moment it was reported, so the compaction check can use
		// baseline + incremental estimate instead of estimating every message.
		// Zero-value (HasUsage false) on the first iteration → full estimate fallback.
		var usageAnchor compact.UsageAnchor

		for iteration := 1; ; iteration++ {
			if a.MaxIterations > 0 && iteration > a.MaxIterations {
				ch <- ErrorEvent{Message: fmt.Sprintf("Agent reached maximum iterations (%d)", a.MaxIterations)}
				return
			}

			if ctx.Err() != nil {
				return
			}

			// Compute the tool schema list once per iteration so the recovery
			// attachment (when compact fires) and the actual Stream call below
			// agree on what's wired up. Skill filters can only change between
			// iterations, never within one.
			toolSchemas := a.currentToolSchemas()

			// Two-layer context management: spill+snip always, autocompact when needed.
			if msg, err := compact.ManageContext(ctx, conv, a.Client, a.WorkDir, a.SessionID, a.ContextWindow, a.MaxOutputTokens, &a.compactTracking, a.RecoveryState, toolSchemas, usageAnchor); err == nil && msg != "" {
				ch <- CompactEvent{Message: msg}
				// A compaction rewrote the conversation, so the prior anchor's
				// AnchorCount no longer maps to the new transcript. Drop it and
				// fall back to a full estimate until the next real usage lands.
				usageAnchor = compact.UsageAnchor{}
			}

			// Plan mode: inject structured workflow reminder.
			if a.Checker != nil && a.Checker.Mode == permissions.ModePlan {
				planPath := planfile.GetOrCreatePlanPath(a.WorkDir)
				// Sync PlanFilePath onto the Checker on every turn so the Layer 0 plan-file write exception
				// works regardless of how Plan Mode was entered (Shift+Tab, SetPermissionMode, /plan).
				a.Checker.PlanFilePath = planPath
				planExists := planfile.PlanExists(a.WorkDir)
				reminder := prompt.BuildPlanModeReminder(planPath, planExists, iteration)
				conv.AddSystemReminder(reminder)
			}

			if a.NotificationFn != nil {
				for _, note := range a.NotificationFn() {
					conv.AddSystemReminder(note)
				}
			}

			a.emitHook(hooks.EventTurnStart, "", nil)

			// Active-skill SOPs live in the conversation as regular messages (injected once when loaded).
			// No per-turn re-injection — they drift naturally and get compacted like any other message.

			// Inject deferred tool names into system-reminder so the model knows what's available via
			// ToolSearch.
			if deferredNames := a.Registry.GetDeferredToolNames(); len(deferredNames) > 0 {
				reminder := "The following deferred tools are available via ToolSearch. Their schemas are NOT loaded - use ToolSearch with query \"select:<name>[,<name>...]\" to load tool schemas before calling them:\n" + strings.Join(deferredNames, "\n")
				conv.AddSystemReminder(reminder)
			}

			a.emitHook(hooks.EventPreSend, "", nil)

			// Layer 1: apply tool-result budget against ReplacementState.
			// Returns a fresh *conversation.Manager with replacements
			// baked in; `conv` is never mutated. All writes that happened
			// earlier in this iteration (system reminders, plan-mode hints,
			// active-skill SOPs) are reflected in apiConv because Apply
			// runs after them and rebuilds the manager from conv.GetMessages().
			apiConv, newRecords, _ := toolresult.Apply(conv, a.WorkDir, a.ReplacementState)
			if len(newRecords) > 0 {
				// Best-effort persistence; failure is non-fatal because the
				// in-memory state already has the canonical decisions for
				// this process lifetime.
				_ = toolresult.AppendRecords(a.WorkDir, newRecords)
			}

			events, errs := a.Client.Stream(ctx, apiConv, toolSchemas)

			var text string
			var toolCalls []llm.ToolCallComplete
			var thinkingBlocks []conversation.ThinkingBlock
			var stopReason string
			var usage llm.UsageInfo

			executor := NewStreamingExecutor(a.Registry, a.Checker, ch)

			for ev := range events {
				switch e := ev.(type) {
				case llm.ThinkingDelta:
					ch <- ThinkingText{Text: e.Text}
				case llm.ThinkingComplete:
					thinkingBlocks = append(thinkingBlocks, conversation.ThinkingBlock{
						Thinking:  e.Thinking,
						Signature: e.Signature,
					})
				case llm.TextDelta:
					text += e.Text
					ch <- StreamText{Text: e.Text}
				case llm.ToolCallStart:
					ch <- ToolUseEvent{ToolID: e.ToolID, ToolName: e.ToolName}
				case llm.ToolCallDelta:
					// ignore
				case llm.ToolCallComplete:
					toolCalls = append(toolCalls, e)
					ch <- ToolUseEvent{
						ToolID:   e.ToolID,
						ToolName: e.ToolName,
						Args:     e.Arguments,
					}
					// Start executing immediately while LLM continues streaming.
					executor.Submit(ctx, a, e)
				case llm.StreamEnd:
					stopReason = e.StopReason
					usage = e.Usage
				}
			}
			a.emitHook(hooks.EventPostReceive, text, nil)

			// Handle stream errors.
			select {
			case err := <-errs:
				if err != nil {
					if retry, compacted := a.handleStreamError(ctx, ch, conv, err); retry {
						if compacted {
							// ForceCompact rewrote the conversation; the prior
							// anchor's AnchorCount no longer maps to it. Drop it
							// so the next check falls back to a full estimate.
							usageAnchor = compact.UsageAnchor{}
						}
						continue // retry the turn
					}
					ch <- ErrorEvent{Message: err.Error()}
					return
				}
			default:
			}

			totalInput += usage.InputTokens
			totalOutput += usage.OutputTokens
			ch <- UsageEvent{InputTokens: totalInput, OutputTokens: totalOutput}

			// Real-usage baseline for this turn: input + cache_read +
			// cache_creation + output. Covers every message that existed when the
			// prompt was sent plus the assistant message about to be appended.
			// anchorBaseline is only adopted as the anchor once that assistant
			// message lands (see anchorAfterAssistant), so anchorCount lines up
			// with the messages the baseline accounts for. Zero usage (compat
			// endpoints that don't report it) leaves the prior anchor in place.
			anchorBaseline := compact.BaselineFromUsage(usage)
			anchorAfterAssistant := func() {
				if anchorBaseline > 0 {
					usageAnchor = compact.UsageAnchor{
						BaselineTokens: anchorBaseline,
						AnchorCount:    conv.Len(),
						HasUsage:       true,
					}
				}
			}

			// Handle max_tokens stop reason.
			if stopReason == "max_tokens" {
				if !maxTokensEscalated {
					// First hit: escalate silently.
					if setter, ok := a.Client.(llm.MaxTokensSetter); ok {
						setter.SetMaxOutputTokens(maxTokensCeiling)
						maxTokensEscalated = true
					}
					if text != "" {
						conv.AddAssistantFull(text, thinkingBlocks, nil)
						anchorAfterAssistant()
						conv.AddUserMessage("Output token limit hit. Resume directly from where you stopped. Do not apologize or repeat previous content. Pick up mid-thought if needed.")
					}
					ch <- RetryEvent{Reason: "max_tokens escalation", Wait: 0}
					continue
				} else if outputRecoveries < maxOutputTokensRecoveries {
					// Multi-turn recovery.
					outputRecoveries++
					conv.AddAssistantFull(text, thinkingBlocks, nil)
					anchorAfterAssistant()
					conv.AddUserMessage("Output token limit hit. Resume directly from where you stopped. Break remaining work into smaller pieces.")
					ch <- RetryEvent{Reason: fmt.Sprintf("max_tokens recovery %d/%d", outputRecoveries, maxOutputTokensRecoveries), Wait: 0}
					continue
				}
				// Exhausted: fall through to normal completion.
			} else {
				// Reset recovery counter on successful turn.
				outputRecoveries = 0
			}

			if len(toolCalls) == 0 {
				conv.AddAssistantFull(text, thinkingBlocks, nil)
				if a.FileHistory != nil {
					summary := text
					if len(summary) > 60 {
						summary = summary[:60] + "..."
					}
					a.FileHistory.MakeSnapshot(conv.Len(), summary)
				}
				ch <- LoopComplete{TotalTurns: iteration}
				if a.OnLoopComplete != nil {
					go a.OnLoopComplete(conv)
				}
				return
			}

			var toolUses []conversation.ToolUseBlock
			for _, tc := range toolCalls {
				toolUses = append(toolUses, conversation.ToolUseBlock{
					ToolUseID: tc.ToolID,
					ToolName:  tc.ToolName,
					Arguments: tc.Arguments,
				})
			}
			conv.AddAssistantFull(text, thinkingBlocks, toolUses)
			// Anchor real usage to the conversation now that the assistant message
			// is in place; subsequent tool results + next user message are
			// estimated incrementally on top of this baseline.
			anchorAfterAssistant()

			// Collect results from streaming executor (tools already started during LLM streaming).
			results := executor.CollectResults()

			var toolResults []conversation.ToolResultBlock
			for _, r := range results {
				if r.isUnknown {
					consecutiveUnknown++
				} else {
					consecutiveUnknown = 0
				}

				ch <- ToolResultEvent{
					ToolID:   r.toolID,
					ToolName: r.toolName,
					Output:   r.output,
					IsError:  r.isError,
					Elapsed:  r.elapsed,
				}

				truncated := r.output
				if len(truncated) > tools.MaxOutputChars {
					truncated = truncated[:tools.MaxOutputChars] + "\n… (output truncated)"
				}
				toolResults = append(toolResults, conversation.ToolResultBlock{
					ToolUseID: r.toolID,
					Content:   truncated,
					IsError:   r.isError,
				})
			}

			if consecutiveUnknown >= 3 {
				ch <- ErrorEvent{Message: "Too many consecutive unknown tool calls"}
				return
			}

			exitPlanCalled := false
			for _, tc := range toolCalls {
				if tc.ToolName == "ExitPlanMode" {
					exitPlanCalled = true
					break
				}
			}
			conv.AddToolResultsMessage(toolResults)
			if exitPlanCalled {
				ch <- TurnComplete{Turn: iteration}
				ch <- LoopComplete{TotalTurns: iteration}
				return
			}
			ch <- TurnComplete{Turn: iteration}
			a.emitHook(hooks.EventTurnEnd, "", nil)
		}
	}()

	return ch
}

// emitHook fires a hook event when an Engine is configured. Failures are non-fatal and surface via
// the hook notification queue (drained into the next turn's system reminders).
func (a *Agent) emitHook(event hooks.EventName, message string, args map[string]any) {
	if a.Hooks == nil {
		return
	}
	a.Hooks.RunHooks(hooks.HookContext{
		EventName: event,
		ToolArgs:  args,
		Message:   message,
	})
}

// filterSchemasByName keeps only the tool schemas whose "name" passes the allow predicate. Used by
// Coordinator Mode to restrict a Lead agent to coordination-only tools while teammates do the
// actual work.
func filterSchemasByName(schemas []map[string]any, allow func(name string) bool) []map[string]any {
	out := make([]map[string]any, 0, len(schemas))
	for _, s := range schemas {
		name, _ := s["name"].(string)
		if allow(name) {
			out = append(out, s)
		}
	}
	return out
}

// handleStreamError returns (retry, compacted): retry signals the caller to
// re-run the turn; compacted signals that a ForceCompact rewrote the
// conversation, so the caller must drop its usage anchor (its AnchorCount no
// longer maps to the new transcript).
func (a *Agent) handleStreamError(ctx context.Context, ch chan AgentEvent, conv *conversation.Manager, err error) (retry, compacted bool) {
	var ctxErr *llm.ContextTooLongError
	if errors.As(err, &ctxErr) {
		msg, compactErr := compact.ForceCompact(ctx, conv, a.Client, a.WorkDir, a.SessionID, a.ContextWindow, a.RecoveryState, a.currentToolSchemas())
		if compactErr == nil && msg != "" {
			ch <- CompactEvent{Message: "Auto-compacted due to context length: " + msg}
			return true, true // retry, and the anchor is now stale
		}
		return false, false
	}

	var rlErr *llm.RateLimitError
	if errors.As(err, &rlErr) {
		wait := parseRetryAfter(rlErr.RetryAfter)
		ch <- RetryEvent{Reason: "rate limited", Wait: wait}
		select {
		case <-time.After(wait):
			return true, false // retry without compaction
		case <-ctx.Done():
			return false, false
		}
	}

	return false, false
}

func parseRetryAfter(header string) time.Duration {
	if header == "" {
		return 5 * time.Second
	}
	if secs, err := strconv.Atoi(header); err == nil {
		return time.Duration(secs) * time.Second
	}
	return 5 * time.Second
}

type toolExecResult struct {
	toolID    string
	toolName  string
	output    string
	isError   bool
	elapsed   time.Duration
	isUnknown bool
}

// extractFilePath pulls a representative path from common tool argument keys so hooks can do path-
// glob matching (`file_path =* "**/*.go"`).
func extractFilePath(args map[string]any) string {
	for _, key := range []string{"file_path", "path", "pattern", "target"} {
		if v, ok := args[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func (a *Agent) executeSingleTool(ctx context.Context, eventCh chan AgentEvent, tc llm.ToolCallComplete) toolExecResult {
	tool := a.Registry.Get(tc.ToolName)
	start := time.Now()

	if tool == nil {
		return toolExecResult{
			toolID:    tc.ToolID,
			toolName:  tc.ToolName,
			output:    fmt.Sprintf("Error: unknown tool '%s'", tc.ToolName),
			isError:   true,
			elapsed:   time.Since(start),
			isUnknown: true,
		}
	}

	if a.Checker != nil {
		decision := a.Checker.Check(tool, tc.Arguments)
		if decision.Effect == permissions.Deny {
			return toolExecResult{
				toolID:   tc.ToolID,
				toolName: tc.ToolName,
				output:   fmt.Sprintf("Permission denied: %s", decision.Reason),
				isError:  true,
				elapsed:  time.Since(start),
			}
		}
		if decision.Effect == permissions.Ask {
			respCh := make(chan PermissionResponse, 1)
			// Use DescribeToolAction to produce a human-readable action description
			desc := permissions.DescribeToolAction(tc.ToolName, tc.Arguments)
			eventCh <- PermissionRequestEvent{
				ToolName:   tc.ToolName,
				Desc:       desc,
				ResponseCh: respCh,
			}
			resp := <-respCh
			if resp == PermDeny {
				return toolExecResult{
					toolID:   tc.ToolID,
					toolName: tc.ToolName,
					output:   "Permission denied by user",
					isError:  true,
					elapsed:  time.Since(start),
				}
			}
			if resp == PermAllowAlways {
				content := permissions.ExtractContent(tc.ToolName, tc.Arguments)
				pattern := content + "*"
				if len(content) > 60 {
					pattern = content[:60] + "*"
				}
				// Layer 4b: add to session-level allowlist (in-memory) and persist to the rule engine
				a.Checker.AddSessionAllow(tc.ToolName, pattern)
				a.Checker.RuleEngine.AppendLocalRule(permissions.Rule{
					ToolName: tc.ToolName,
					Pattern:  pattern,
					Effect:   permissions.RuleAllow,
				})
			}
		}
	}

	if a.Hooks != nil {
		hctx := hooks.HookContext{
			EventName: hooks.EventPreToolUse,
			ToolName:  tc.ToolName,
			ToolArgs:  tc.Arguments,
			FilePath:  extractFilePath(tc.Arguments),
		}
		if rejected, msg := a.Hooks.RunPreToolHooks(hctx); rejected {
			return toolExecResult{
				toolID:   tc.ToolID,
				toolName: tc.ToolName,
				output:   "Blocked by hook: " + msg,
				isError:  true,
				elapsed:  time.Since(start),
			}
		}
	}

	result := tool.Execute(ctx, tc.Arguments)

	// Snapshot what ReadFile just handed to the model so the compact
	// recovery block can replay it after a Layer 2 summary wipes the
	// transcript. Re-reading from disk is one extra open per ReadFile —
	// cheaper than parsing line numbers back out of the tool output.
	if !result.IsError && tc.ToolName == "ReadFile" {
		if p, _ := tc.Arguments["file_path"].(string); p != "" {
			if data, err := os.ReadFile(p); err == nil {
				a.RecoveryState.RecordFileRead(p, string(data))
			}
		}
	}

	if a.Hooks != nil {
		a.Hooks.RunHooks(hooks.HookContext{
			EventName: hooks.EventPostToolUse,
			ToolName:  tc.ToolName,
			ToolArgs:  tc.Arguments,
			FilePath:  extractFilePath(tc.Arguments),
			Message:   result.Output,
		})
	}

	return toolExecResult{
		toolID:   tc.ToolID,
		toolName: tc.ToolName,
		output:   result.Output,
		isError:  result.IsError,
		elapsed:  time.Since(start),
	}
}

func formatToolArgs(args map[string]any) string {
	var parts []string
	for k, v := range args {
		s := fmt.Sprintf("%v", v)
		if len(s) > 80 {
			s = s[:80] + "…"
		}
		parts = append(parts, fmt.Sprintf("%s: %s", k, s))
	}
	return strings.Join(parts, ", ")
}
