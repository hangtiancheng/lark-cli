// Package toolresult implements Larky's Design-B tool-result budget:
// every replacement decision is recorded in ContentReplacementState and
// applied to a freshly-built *conversation.Manager so the input conversation
// is never mutated. State across turns is what makes the model-visible
// prefix byte-stable for Anthropic prompt cache.
package toolresult

// ContentReplacementState is the per-conversation-thread decision log.
//
//   - SeenIDs holds every tool_use_id that has passed through Apply at least
//     once. Once seen, the decision (replaced or not) is frozen forever for
//     that id.
//   - Replacements holds the byte-exact preview string for every id that was
//     decided "replace". Subsequent turns re-apply this string verbatim — no
//     filesystem I/O, no formatting, no chance of drift.
//
// Invariant: keys(Replacements) ⊆ SeenIDs.
type ContentReplacementState struct {
	SeenIDs      map[string]struct{}
	Replacements map[string]string
}

// New returns an empty state. One instance per conversation thread; the
// main Agent holds one and threads it through every Apply call.
func New() *ContentReplacementState {
	return &ContentReplacementState{
		SeenIDs:      make(map[string]struct{}),
		Replacements: make(map[string]string),
	}
}

// Clone produces an independent copy. Used at fork time so the child agent
// inherits the parent's frozen decisions but does not write back into the
// parent's map. Both maps store value types (struct{} / string), so a key
// copy is sufficient — no deep copy needed.
func (s *ContentReplacementState) Clone() *ContentReplacementState {
	out := &ContentReplacementState{
		SeenIDs:      make(map[string]struct{}, len(s.SeenIDs)),
		Replacements: make(map[string]string, len(s.Replacements)),
	}
	for k := range s.SeenIDs {
		out.SeenIDs[k] = struct{}{}
	}
	for k, v := range s.Replacements {
		out.Replacements[k] = v
	}
	return out
}
