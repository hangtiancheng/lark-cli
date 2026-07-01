package toolresult

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"larky/internal/conversation"
)

// Budget thresholds. Values match the ch08 spec; ContentReplacementState
// freezes decisions, but the actual numerical limits stay the same as the
// pre-state implementation so behavior on a fresh conversation is identical.
const (
	// SingleResultLimit gates the per-tool spill. Aligned with Claude Code's
	// DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000. Must stay strictly above
	// tools.MaxOutputChars (10000) + truncation suffix; otherwise a tool
	// result truncated to MaxOutputChars trips the spill on every iteration
	// — and reading the spilled file back is itself a ~10K result that
	// would re-spill, looping.
	SingleResultLimit = 50000

	// MessageAggregateLimit triggers Pass 2 when a single user message's
	// tool_result content sums above this. Aligned with Claude Code's
	// MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000.
	MessageAggregateLimit = 200000

	// OldResultSnipChars is the stale-tail snip threshold.
	OldResultSnipChars = 2000

	// KeepRecentTurns is the recent-window boundary that snip never touches.
	KeepRecentTurns = 10

	// SpillSubdir lives under the agent's workdir.
	SpillSubdir = ".larky/tool_results"
)

const (
	persistedTagPrefix = "[Result of "
	snippedTagPrefix   = "[Stale output snipped:"
)

func isAlreadyReplaced(s string) bool {
	return strings.HasPrefix(s, persistedTagPrefix) || strings.HasPrefix(s, snippedTagPrefix)
}

// Apply is Design B: walk conv, decide each tool_result's fate against state,
// return a NEW *conversation.Manager with replacements applied. The input
// conv is never mutated. state's SeenIDs/Replacements are mutated to record
// this turn's decisions; subsequent calls re-apply those decisions verbatim
// (byte-identical preview strings, no I/O) so the prompt-cache prefix is
// stable across turns.
//
// Returns the new manager, any newly-recorded decisions (caller should
// append to the session transcript), and an error only on catastrophic
// failure (filesystem errors during spill are swallowed per-result so a
// spill failure freezes that one id as raw rather than aborting the turn).
func Apply(
	conv *conversation.Manager,
	workDir string,
	state *ContentReplacementState,
) (*conversation.Manager, []Record, error) {
	messages := conv.GetMessages()
	if len(messages) == 0 {
		return conv, nil, nil
	}

	spillDir := filepath.Join(workDir, SpillSubdir)
	absSpillDir, _ := filepath.Abs(spillDir)
	toolUseByID := buildToolUseIndex(messages)

	var records []Record
	newMessages := make([]conversation.Message, len(messages))

	for i, msg := range messages {
		if len(msg.ToolResults) == 0 {
			newMessages[i] = msg
			continue
		}

		decisions := make(map[string]string, len(msg.ToolResults))
		var fresh []conversation.ToolResultBlock

		for _, tr := range msg.ToolResults {
			if rep, ok := state.Replacements[tr.ToolUseID]; ok {
				// Already decided "replace" — re-apply the exact preview.
				decisions[tr.ToolUseID] = rep
				continue
			}
			if _, ok := state.SeenIDs[tr.ToolUseID]; ok {
				// Seen but not replaced — frozen as raw forever.
				decisions[tr.ToolUseID] = tr.Content
				continue
			}
			if isAlreadyReplaced(tr.Content) {
				// External pre-tagged content (e.g. resumed from disk where
				// the persisted preview was already written into history).
				// Freeze as the tag itself so subsequent turns stay stable.
				state.SeenIDs[tr.ToolUseID] = struct{}{}
				state.Replacements[tr.ToolUseID] = tr.Content
				decisions[tr.ToolUseID] = tr.Content
				records = append(records, Record{
					Kind:        "tool-result",
					ToolUseID:   tr.ToolUseID,
					Replacement: tr.Content,
				})
				continue
			}
			fresh = append(fresh, tr)
		}

		// Pass 1: persist any single result above SingleResultLimit.
		persistedByP1 := make(map[string]struct{})
		for _, tr := range fresh {
			if len(tr.Content) <= SingleResultLimit {
				continue
			}
			if isSpillReadback(toolUseByID[tr.ToolUseID], absSpillDir) {
				// Reading a previously-spilled file back — don't spill the
				// readback (it would loop: the readback's own result is
				// ~same size as the spilled file).
				state.SeenIDs[tr.ToolUseID] = struct{}{}
				decisions[tr.ToolUseID] = tr.Content
				persistedByP1[tr.ToolUseID] = struct{}{}
				continue
			}
			path, err := writeSpill(spillDir, tr.ToolUseID, tr.Content)
			if err != nil {
				// Spill failed → freeze as raw (decision still made: never
				// revisit). Subsequent turns will treat this id as frozen-
				// not-replaced and send the raw content.
				state.SeenIDs[tr.ToolUseID] = struct{}{}
				decisions[tr.ToolUseID] = tr.Content
				persistedByP1[tr.ToolUseID] = struct{}{}
				continue
			}
			preview := buildSpillPreview(tr.Content, path)
			decisions[tr.ToolUseID] = preview
			state.SeenIDs[tr.ToolUseID] = struct{}{}
			state.Replacements[tr.ToolUseID] = preview
			records = append(records, Record{
				Kind:        "tool-result",
				ToolUseID:   tr.ToolUseID,
				Replacement: preview,
			})
			persistedByP1[tr.ToolUseID] = struct{}{}
		}

		// Pass 2: aggregate-spill the largest remaining fresh candidates
		// until total ≤ MessageAggregateLimit.
		var remaining []conversation.ToolResultBlock
		for _, tr := range fresh {
			if _, done := persistedByP1[tr.ToolUseID]; done {
				continue
			}
			remaining = append(remaining, tr)
		}

		total := 0
		for _, c := range decisions {
			total += len(c)
		}
		for _, tr := range remaining {
			total += len(tr.Content)
		}

		if total > MessageAggregateLimit && len(remaining) > 0 {
			sorted := append([]conversation.ToolResultBlock(nil), remaining...)
			sort.SliceStable(sorted, func(a, b int) bool {
				return len(sorted[a].Content) > len(sorted[b].Content)
			})
			for _, tr := range sorted {
				if total <= MessageAggregateLimit {
					break
				}
				if isSpillReadback(toolUseByID[tr.ToolUseID], absSpillDir) {
					state.SeenIDs[tr.ToolUseID] = struct{}{}
					decisions[tr.ToolUseID] = tr.Content
					continue
				}
				path, err := writeSpill(spillDir, tr.ToolUseID, tr.Content)
				if err != nil {
					state.SeenIDs[tr.ToolUseID] = struct{}{}
					decisions[tr.ToolUseID] = tr.Content
					continue
				}
				preview := buildSpillPreview(tr.Content, path)
				decisions[tr.ToolUseID] = preview
				state.SeenIDs[tr.ToolUseID] = struct{}{}
				state.Replacements[tr.ToolUseID] = preview
				records = append(records, Record{
					Kind:        "tool-result",
					ToolUseID:   tr.ToolUseID,
					Replacement: preview,
				})
				total -= len(tr.Content) - len(preview)
			}
		}

		// Freeze remaining fresh as "seen but not replaced".
		for _, tr := range fresh {
			if _, decided := decisions[tr.ToolUseID]; decided {
				continue
			}
			state.SeenIDs[tr.ToolUseID] = struct{}{}
			decisions[tr.ToolUseID] = tr.Content
		}

		// Materialize new tool_results in original order.
		newResults := make([]conversation.ToolResultBlock, len(msg.ToolResults))
		for k, tr := range msg.ToolResults {
			newResults[k] = conversation.ToolResultBlock{
				ToolUseID: tr.ToolUseID,
				Content:   decisions[tr.ToolUseID],
				IsError:   tr.IsError,
			}
		}
		newMsg := msg
		newMsg.ToolResults = newResults
		newMessages[i] = newMsg
	}

	// Pass 3: stale-snip on the new history. Stateless — the boundary moves
	// as turns add, so an id can flip from raw to snipped at one turn (this
	// is a known prefix-cache drift, accepted as out-of-scope for the state
	// machine — fixing it requires either snipping eagerly or making snip
	// state-aware too).
	newMessages = snipStale(newMessages)

	return buildManager(newMessages), records, nil
}

// previewSize is the max character count for spill previews, consistent with Claude Code.
const previewSize = 2000

// buildSpillPreview constructs spill replacement text with a leading 2KB preview.
// Once written to state.Replacements it is replayed byte-by-byte; format changes will
// invalidate the prompt cache — do not alter lightly.
func buildSpillPreview(content string, path string) string {
	sizeKB := len(content) / 1024
	preview := content
	hasMore := false
	if len(preview) > previewSize {
		preview = preview[:previewSize]
		hasMore = true
	}
	var b strings.Builder
	fmt.Fprintf(&b, "<persisted-output>\n")
	fmt.Fprintf(&b, "Output too large (%dKB), full content saved to:\n%s\n\n", sizeKB, path)
	fmt.Fprintf(&b, "Preview (first 2KB):\n%s", preview)
	if hasMore {
		b.WriteString("\n...")
	}
	b.WriteString("\n</persisted-output>")
	return b.String()
}

func snipStale(messages []conversation.Message) []conversation.Message {
	totalTurns := 0
	for _, m := range messages {
		if m.Role == "assistant" && len(m.ToolUses) == 0 {
			totalTurns++
		}
	}
	if totalTurns <= KeepRecentTurns {
		return messages
	}
	out := make([]conversation.Message, len(messages))
	turnsSeen := 0
	oldBoundary := totalTurns - KeepRecentTurns
	for i, m := range messages {
		if m.Role == "assistant" && len(m.ToolUses) == 0 {
			turnsSeen++
		}
		if turnsSeen > oldBoundary || len(m.ToolResults) == 0 {
			out[i] = m
			continue
		}
		var newResults []conversation.ToolResultBlock
		changed := false
		for _, tr := range m.ToolResults {
			if isAlreadyReplaced(tr.Content) || len(tr.Content) <= OldResultSnipChars {
				newResults = append(newResults, tr)
				continue
			}
			newResults = append(newResults, conversation.ToolResultBlock{
				ToolUseID: tr.ToolUseID,
				Content:   fmt.Sprintf("[Stale output snipped: %d chars]", len(tr.Content)),
				IsError:   tr.IsError,
			})
			changed = true
		}
		if changed {
			nm := m
			nm.ToolResults = newResults
			out[i] = nm
		} else {
			out[i] = m
		}
	}
	return out
}

// buildToolUseIndex maps tool_use_id → ToolUseBlock so spill decisions can
// inspect the originating tool name and arguments. Tool uses live on
// assistant messages while results live on the next user message, paired
// only by ID — pre-indexing avoids an O(n²) cross-message scan.
func buildToolUseIndex(messages []conversation.Message) map[string]conversation.ToolUseBlock {
	idx := make(map[string]conversation.ToolUseBlock, len(messages))
	for _, m := range messages {
		for _, tu := range m.ToolUses {
			idx[tu.ToolUseID] = tu
		}
	}
	return idx
}

// isSpillReadback reports whether the originating tool call was a ReadFile
// of a path inside the spill directory. Spilling the readback would loop —
// the readback's own result is ~same size as the spilled file, so it'd trip
// SingleResultLimit again and produce a chain of stub-of-stub files.
func isSpillReadback(tu conversation.ToolUseBlock, absSpillDir string) bool {
	if tu.ToolName != "ReadFile" || absSpillDir == "" {
		return false
	}
	raw, _ := tu.Arguments["file_path"].(string)
	if raw == "" {
		return false
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return false
	}
	return strings.HasPrefix(abs, absSpillDir)
}

func writeSpill(dir, toolUseID, content string) (string, error) {
	if toolUseID == "" {
		return "", fmt.Errorf("empty tool_use_id")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, toolUseID)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return path, nil
		}
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		return "", err
	}
	return path, nil
}

// buildManager constructs a fresh *conversation.Manager from a message
// slice. We can't set the unexported `history` field from outside the
// conversation package, so we replay messages through the public Add*
// API. Same pattern as compact.rebuildConversation, kept local to avoid a
// cross-package dependency.
func buildManager(messages []conversation.Message) *conversation.Manager {
	out := conversation.NewManager()
	for _, m := range messages {
		switch {
		case len(m.ToolUses) > 0:
			out.AddAssistantFull(m.Content, m.ThinkingBlocks, m.ToolUses)
		case len(m.ToolResults) > 0:
			out.AddToolResultsMessage(m.ToolResults)
		case m.Role == "user":
			out.AddUserMessage(m.Content)
		case m.Role == "assistant":
			out.AddAssistantMessage(m.Content)
		}
	}
	return out
}
