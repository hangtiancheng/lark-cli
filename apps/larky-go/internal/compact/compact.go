// Package compact implements Larky's Layer 2 context management:
// an LLM-driven full-conversation summary, gated by token ratio (default
// >80% of context window). Replaces the entire conversation with a summary
// message + a continuation acknowledgement. Also reachable via ForceCompact
// (the /compact slash command).
//
// Layer 1 (per-result spill + per-message aggregate budget + stale snip)
// lives in package toolresult and is invoked by the Agent loop directly,
// because it needs a ContentReplacementState that crosses turns.
package compact

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hangtiancheng/lark-cli/apps/larky/internal/conversation"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/llm"
	"github.com/hangtiancheng/lark-cli/apps/larky/internal/session"
)

const (
	// autoCompactThreshold is the legacy ratio gate (kept for reference only).
	// The live decision now uses the absolute-token formula below, aligned with
	// Claude Code's autoCompact.ts: trigger on used-tokens >= effectiveWindow − margin.
	autoCompactThreshold = 0.80

	// summaryOutputReserve reserves room for the summary response itself, so the
	// effective window is contextWindow − min(model maxOutput, summaryOutputReserve).
	summaryOutputReserve = 20000
	// autoCompactSafetyMargin sets the soft auto-compact trigger line below the
	// effective window.
	autoCompactSafetyMargin = 13000
	// manualCompactSafetyMargin sets the hard-block line: once used tokens cross
	// effectiveWindow − manualCompactSafetyMargin, we force a compaction rather
	// than rely on the soft trigger.
	manualCompactSafetyMargin = 3000
)

// Recent-message retention budget for compaction, aligned with Claude Code's
// compact.ts buildPostCompactMessages: instead of summarizing the whole
// transcript and discarding every original message, we keep the tail of recent
// messages verbatim and only summarize the older prefix.
const (
	// keepRecentTokens is the lower-bound token budget: walk back from the tail
	// accumulating per-message tokens until we've kept at least this many.
	keepRecentTokens = 10000
	// minKeepMessages is the minimum number of recent messages to keep regardless
	// of token count. Either keepRecentTokens or minKeepMessages satisfied is
	// enough to stop walking back (whichever comes first).
	minKeepMessages = 5
	// keepMaxTokens caps the kept tail: once accumulated tokens would exceed this,
	// stop walking back even if the lower bounds aren't met, so we never keep so
	// much that the summary saves nothing.
	keepMaxTokens = 40000
)

// computeCompactThreshold returns the absolute used-token line at which Layer 2
// should fire. effectiveWindow = contextWindow − min(maxOutput, summaryOutputReserve);
// the threshold is effectiveWindow minus the safety margin (manual margin for the
// hard-block line, auto margin for the soft trigger).
func computeCompactThreshold(contextWindow, maxOutput int, manual bool) int {
	reserve := summaryOutputReserve
	if maxOutput > 0 && maxOutput < reserve {
		reserve = maxOutput
	}
	effectiveWindow := contextWindow - reserve
	margin := autoCompactSafetyMargin
	if manual {
		margin = manualCompactSafetyMargin
	}
	return effectiveWindow - margin
}

// MaxConsecutiveAutoCompactFailures stops auto-compact retries when the context is irrecoverably
// over the limit (e.g., prompt_too_long), so the agent doesn't hammer the API with doomed attempts
// on every iteration.
const MaxConsecutiveAutoCompactFailures = 3

// AutoCompactTrackingState threads circuit-breaker state across agent loop iterations. The caller
// owns the struct; ManageContext mutates it in place.
type AutoCompactTrackingState struct {
	// ConsecutiveFailures counts auto-compact attempts that returned an error since the last success.
	// Reset to zero on success.
	ConsecutiveFailures int
}

// summarySystemPrompt instructs the model to produce a two-phase response: a <analysis> scratchpad
// block followed by a <summary> block. The analysis block is stripped by formatCompactSummary
// before the result is written back into the conversation, leaving only the structured summary.
const summarySystemPrompt = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, code snippets, function signatures, file edits
   - Errors that you ran into and how you fixed them
   - Specific user feedback received, especially corrections
2. Double-check for technical accuracy and completeness.

After your analysis, output your final summary wrapped in <summary> tags. The summary MUST preserve:
- All file paths that were read, modified, or created
- Key decisions and their rationale
- The current task/goal and overall progress
- Any pending work or next steps
- Error states and their resolution
- Important code snippets or patterns discussed

Output structure:

<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
[The final compact summary that retains all actionable context]
</summary>`

// EstimateTokens uses a 3.5 chars/token approximation across content, tool args, tool results, and
// thinking blocks.
func EstimateTokens(messages []conversation.Message) int {
	total := 0
	for _, m := range messages {
		total += int(float64(len(m.Content))/3.5) + 4
		for _, tu := range m.ToolUses {
			argsJSON, _ := json.Marshal(tu.Arguments)
			total += 50 + int(float64(len(argsJSON))/3.5)
		}
		for _, tr := range m.ToolResults {
			total += int(float64(len(tr.Content))/3.5) + 10
		}
		for _, tb := range m.ThinkingBlocks {
			total += int(float64(len(tb.Thinking)) / 3.5)
		}
	}
	return total
}

// UsageAnchor records the last real API usage and the conversation length at the
// moment that usage was reported. baselineTokens is the total true prompt+output
// size for that turn (input + cache_read + cache_creation + output); anchorCount
// is conv.Len() right after the assistant turn settled. Anything appended past
// anchorCount (tool results, the next user message, system reminders) has no real
// usage yet, so it's estimated incrementally on top of the baseline.
//
// A zero-value anchor (HasUsage false) means no real usage has been observed yet
// — the first turn — so callers fall back to a full character estimate.
type UsageAnchor struct {
	BaselineTokens int
	AnchorCount    int
	HasUsage       bool
}

// BaselineFromUsage collapses an API usage report into the single "true tokens
// already on the wire" number used as the anchor baseline. Anthropic reports
// cache_read / cache_creation separately from input_tokens, so the real prompt
// size is the sum of all four counters.
func BaselineFromUsage(u llm.UsageInfo) int {
	return u.InputTokens + u.CacheReadTokens + u.CacheCreationTokens + u.OutputTokens
}

// ComputeUsedTokens returns the current "used tokens" figure that the compaction
// threshold is compared against. When a real-usage anchor exists, it returns
// baselineTokens + an estimate of only the messages appended after the anchor
// (incremental estimate). Without an anchor (cold start, first turn) it falls
// back to a full character estimate over every message, matching the original
// behaviour so the agent stays usable before the first usage report lands.
func ComputeUsedTokens(messages []conversation.Message, anchor UsageAnchor) int {
	if !anchor.HasUsage {
		return EstimateTokens(messages)
	}
	// Defensive clamp: if the conversation was rewound below the anchor (e.g.
	// after a compaction) the anchor is stale, so estimate everything instead
	// of indexing out of range.
	if anchor.AnchorCount < 0 || anchor.AnchorCount > len(messages) {
		return EstimateTokens(messages)
	}
	return anchor.BaselineTokens + EstimateTokens(messages[anchor.AnchorCount:])
}

// ManageContext runs Layer 2 (autoCompact) when used tokens reach the
// auto-compact threshold (effectiveWindow − auto margin); once they cross the
// hard-block line (effectiveWindow − manual margin) it forces a compaction.
// See computeCompactThreshold. Layer 1 (tool-result budget) is invoked by the
// caller directly via toolresult.Apply before this function — they're
// independent now because Layer 1 needs to thread ContentReplacementState
// across turns, which sits naturally on the Agent rather than buried inside
// a compact helper.
//
// tracking carries the circuit-breaker state across iterations. When nil,
// the circuit breaker is disabled (useful for tests and one-shot callers).
//
// anchor carries the most recent real API usage (baseline + conversation length
// at the time it was reported). When present, the used-token figure is
// baselineTokens + an incremental estimate of only the messages appended since;
// when absent (first turn) it falls back to a full character estimate. This
// only changes how "currently used tokens" is computed — the threshold formula
// (effectiveWindow − margin) is untouched.
//
// `workDir` + `sessionID` locate the on-disk session log; when both are
// non-empty, a successful compaction appends a compact_boundary record there so
// a later resume can rebuild the compacted state instead of replaying the full
// pre-compaction transcript. When either is empty, boundary persistence is
// skipped (tests, one-shot callers) and behaviour is unchanged.
func ManageContext(
	ctx context.Context,
	conv *conversation.Manager,
	client llm.Client,
	workDir string,
	sessionID string,
	contextWindow int,
	maxOutput int,
	tracking *AutoCompactTrackingState,
	recovery *RecoveryState,
	toolSchemas []map[string]any,
	anchor UsageAnchor,
) (string, error) {
	tokens := ComputeUsedTokens(conv.GetMessages(), anchor)
	// Soft auto-compact trigger: used tokens >= effectiveWindow − auto margin.
	if tokens < computeCompactThreshold(contextWindow, maxOutput, false) {
		return "", nil
	}

	// Hard-block line: once used tokens cross effectiveWindow − manual margin,
	// force a compaction (bypassing the circuit breaker) instead of the soft
	// auto path, since the context is too close to the wall to risk skipping.
	if tokens >= computeCompactThreshold(contextWindow, maxOutput, true) {
		return ForceCompact(ctx, conv, client, workDir, sessionID, contextWindow, recovery, toolSchemas)
	}

	// Circuit breaker: stop retrying after N consecutive failures. Without
	// this, sessions where context is irrecoverably over the limit hammer
	// the API with doomed compaction attempts on every iteration.
	if tracking != nil && tracking.ConsecutiveFailures >= MaxConsecutiveAutoCompactFailures {
		return "", nil
	}

	msg, err := autoCompact(ctx, conv, client, workDir, sessionID, contextWindow, recovery, toolSchemas)
	if err != nil {
		if tracking != nil {
			tracking.ConsecutiveFailures++
		}
		return "", err
	}
	if tracking != nil {
		tracking.ConsecutiveFailures = 0
	}
	return msg, nil
}

// ForceCompact is the manual /compact entry. Always runs Layer 2 (full summary) regardless of
// current token ratio. Layer 1 is skipped because a full summary supersedes spill/snip anyway.
func ForceCompact(
	ctx context.Context,
	conv *conversation.Manager,
	client llm.Client,
	workDir string,
	sessionID string,
	contextWindow int,
	recovery *RecoveryState,
	toolSchemas []map[string]any,
) (string, error) {
	return autoCompact(ctx, conv, client, workDir, sessionID, contextWindow, recovery, toolSchemas)
}

// hasToolResults reports whether a message carries any tool_result blocks (a
// user-role message produced by the tool executor). Such a message must not be
// separated from the assistant tool_use it answers, or the API rejects the
// conversation as having an orphaned tool_result.
func hasToolResults(m conversation.Message) bool {
	return len(m.ToolResults) > 0
}

// hasToolUses reports whether a message carries any tool_use blocks (an
// assistant message that called a tool).
func hasToolUses(m conversation.Message) bool {
	return len(m.ToolUses) > 0
}

// computeKeepStartIndex chooses the boundary between the prefix that gets
// summarized (messages[:keepStart]) and the recent tail kept verbatim
// (messages[keepStart:]), mirroring Claude Code's messagesToKeep selection.
//
// Walk back from the tail accumulating per-message tokens (single-message
// EstimateTokens). Stop once EITHER the token lower bound (keepRecentTokens) OR
// the message-count lower bound (minKeepMessages) is met — whichever comes
// first is enough. But never let the accumulated tail exceed keepMaxTokens: if
// including one more message would cross that cap, stop before it.
//
// After the budget walk, snap the boundary backward so it never splits a
// tool_use ↔ tool_result pair: if keepStart lands on a message bearing
// tool_results, move it back past the preceding assistant tool_use message(s)
// so the pair stays whole in the kept tail (keep a full pair rather than an
// orphaned tool_result).
//
// Returns the index; callers treat keepStart <= 0 (or a tiny prefix) as "too
// little to compact" and fall back to the original full-summary behaviour.
func computeKeepStartIndex(messages []conversation.Message) int {
	n := len(messages)
	if n == 0 {
		return 0
	}

	keptTokens := 0
	keptCount := 0
	keepStart := n
	for i := n - 1; i >= 0; i-- {
		msgTokens := EstimateTokens(messages[i : i+1])
		// Upper bound: if adding this message would exceed the cap, stop and
		// leave it in the summarized prefix (don't keep it).
		if keptCount > 0 && keptTokens+msgTokens > keepMaxTokens {
			break
		}
		keptTokens += msgTokens
		keptCount++
		keepStart = i
		// Lower bounds: either satisfied → done.
		if keptTokens >= keepRecentTokens || keptCount >= minKeepMessages {
			break
		}
	}

	// Don't split a tool_use ↔ tool_result pair: if the boundary message holds
	// tool_results, move it back across the assistant tool_use message(s) it
	// answers so the pair is kept intact.
	for keepStart > 0 && hasToolResults(messages[keepStart]) {
		prev := keepStart - 1
		if hasToolUses(messages[prev]) {
			keepStart = prev
			continue
		}
		break
	}

	return keepStart
}

// autoCompact is Layer 2: an LLM summary of the older prefix that replaces only
// messages[:keepStart] with a single summary message, while the recent tail
// (messages[keepStart:]) is preserved verbatim — aligned with Claude Code's
// buildPostCompactMessages messagesToKeep. After the summary lands, a recovery
// block is appended to the summary message so the model still has snapshots of
// the files it just read, the SOPs for any skills it invoked, and the current
// tool listing. When there's too little prefix to summarize, it degrades to the
// original full-summary behaviour.
func autoCompact(
	ctx context.Context,
	conv *conversation.Manager,
	client llm.Client,
	workDir string,
	sessionID string,
	contextWindow int,
	recovery *RecoveryState,
	toolSchemas []map[string]any,
) (string, error) {
	messages := conv.GetMessages()
	beforeTokens := EstimateTokens(messages)

	// Select the recent tail to keep verbatim; only the prefix before keepStart
	// is summarized. If the boundary leaves nothing (or almost nothing) to
	// summarize, there's no point compacting — keep the conversation untouched.
	keepStart := computeKeepStartIndex(messages)
	if keepStart <= 0 {
		// Everything is within the kept tail (conversation too short) — degrade
		// to no-op so we don't "compact for nothing".
		return "", nil
	}
	prefix := messages[:keepStart]
	keep := messages[keepStart:]

	var sb strings.Builder
	for _, m := range prefix {
		sb.WriteString(fmt.Sprintf("[%s]: %s\n", m.Role, m.Content))
		for _, tu := range m.ToolUses {
			sb.WriteString(fmt.Sprintf("[tool_use %s]: %s\n", tu.ToolName, tu.ToolUseID))
		}
		for _, tr := range m.ToolResults {
			content := tr.Content
			if len(content) > 500 {
				content = content[:500] + "..."
			}
			sb.WriteString(fmt.Sprintf("[tool_result]: %s\n", content))
		}
	}

	summaryConv := conversation.NewManager()
	summaryConv.AddUserMessage(summarySystemPrompt + "\n\n" + sb.String())

	events, errs := client.Stream(ctx, summaryConv, nil)
	var summary strings.Builder
	for ev := range events {
		if td, ok := ev.(llm.TextDelta); ok {
			summary.WriteString(td.Text)
		}
	}
	select {
	case err := <-errs:
		if err != nil {
			return "", err
		}
	default:
	}

	finalSummary := formatCompactSummary(summary.String())

	// Persist a compact_boundary record so a later resume can rebuild this
	// compacted state (summary + kept tail) instead of replaying the full
	// pre-compaction transcript. Append-only: the original prefix messages stay
	// in the session file but won't be replayed past this boundary. We inline the
	// kept tail as role+content text (matching how the session log already stores
	// messages — text only, no tool blocks). The boundary stores the pure summary
	// text, not the recovery attachment, since the recovery snapshots are an
	// in-memory rebuild aid unavailable on resume. Skipped when sessionID/workDir
	// is empty (tests, one-shot callers).
	if sessionID != "" && workDir != "" {
		keepRecords := make([]session.KeepMessage, 0, len(keep))
		for _, m := range keep {
			keepRecords = append(keepRecords, session.KeepMessage{Role: m.Role, Content: m.Content})
		}
		session.SaveCompactBoundary(workDir, sessionID, finalSummary, keepRecords)
	}

	content := "本次会话延续自之前的对话，因上下文空间不足进行了压缩。以下是早期对话的摘要：\n\n" + finalSummary
	if len(keep) > 0 {
		content += "\n\n近期消息已原样保留。"
	}
	if sessionID != "" && workDir != "" {
		content += fmt.Sprintf("\n\n如果你需要压缩前的具体细节（代码片段、报错信息等），请用 ReadFile 读取完整会话记录：%s", session.SessionFilePath(workDir, sessionID))
	}
	if attachment := BuildRecoveryAttachment(recovery, toolSchemas); attachment != "" {
		content += "\n\n---\n\n" + attachment
	}

	compacted := conversation.NewManager()
	compacted.AddUserMessage(content)
	compacted.AppendMessages(keep)

	*conv = *compacted
	afterTokens := EstimateTokens(conv.GetMessages())
	return fmt.Sprintf("Compacted: %d → %d estimated tokens", beforeTokens, afterTokens), nil
}

// formatCompactSummary strips the <analysis> scratchpad block from the model's two-phase response,
// returning only the contents of the <summary> block. Falls back to the raw text when neither tag
// is present (model disobeyed the prompt structure) so we never lose the summary altogether.
func formatCompactSummary(raw string) string {
	if start := strings.Index(raw, "<summary>"); start >= 0 {
		body := raw[start+len("<summary>"):]
		if end := strings.Index(body, "</summary>"); end >= 0 {
			return strings.TrimSpace(body[:end])
		}
		return strings.TrimSpace(body)
	}
	// No <summary> block — drop any <analysis>.</analysis> block if present and return what's left.
	if start := strings.Index(raw, "<analysis>"); start >= 0 {
		if end := strings.Index(raw, "</analysis>"); end > start {
			return strings.TrimSpace(raw[:start] + raw[end+len("</analysis>"):])
		}
	}
	return strings.TrimSpace(raw)
}
