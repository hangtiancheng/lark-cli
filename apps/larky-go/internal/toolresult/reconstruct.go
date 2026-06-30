package toolresult

import "github.com/hangtiancheng/lark-cli/apps/larky/internal/conversation"

// Reconstruct rebuilds state from a transcript: seed SeenIDs with every
// candidate tool_use_id present in messages (anything visible at this point
// has already been sent to the model, so the decision is implicitly
// frozen), then overlay Replacements from the on-disk records. Optional
// inheritedReplacements lets a fork resume gap-fill the parent's live
// state for ids that didn't make it into the records file (e.g. forks that
// share a tool_use_id whose preview was recorded only in the parent).
func Reconstruct(
	messages []conversation.Message,
	records []Record,

	inheritedReplacements map[string]string,
) *ContentReplacementState {
	state := New()
	candidateIDs := make(map[string]struct{})
	for _, m := range messages {
		for _, tr := range m.ToolResults {
			candidateIDs[tr.ToolUseID] = struct{}{}
		}
	}
	for id := range candidateIDs {
		state.SeenIDs[id] = struct{}{}

	}
	for _, r := range records {
		if r.Kind != "tool-result" {
			continue
		}
		if _, ok := candidateIDs[r.ToolUseID]; ok {
			state.Replacements[r.ToolUseID] = r.Replacement
		}
	}
	for id, rep := range inheritedReplacements {
		if _, ok := candidateIDs[id]; !ok {
			continue
		}
		if _, exists := state.Replacements[id]; exists {
			continue
		}
		state.Replacements[id] = rep
	}
	return state
}
