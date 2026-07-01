package tui

import (
	"strings"
)

// StreamBlock accumulates LLM streaming tokens and renders the final text as
// Markdown once the stream ends. Mirrors Python's LLMStreamBlock.
//
// During streaming, tokens are accumulated as plain text (avoiding the
// per-token cost of re-rendering Markdown). When FinalizeMarkdown is called,
// the full text is rendered through glamour for a polished final display.
type StreamBlock struct {
	text      strings.Builder
	finalized bool
	rendered  string
}

// NewStreamBlock creates an empty streaming block.
func NewStreamBlock() *StreamBlock {
	return &StreamBlock{}
}

// AppendToken appends a streaming token. Once finalized, additional tokens
// are ignored to prevent stale writes.
func (s *StreamBlock) AppendToken(token string) {
	if s.finalized {
		return
	}
	s.text.WriteString(token)
}

// FinalizeMarkdown renders the accumulated text as Markdown via glamour.
// Subsequent AppendToken calls are ignored.
func (s *StreamBlock) FinalizeMarkdown(width int) {
	if s.finalized {
		return
	}
	s.finalized = true
	s.rendered = renderMarkdown(s.text.String(), width)
}

// IsFinalized reports whether the block has been finalized.
func (s *StreamBlock) IsFinalized() bool {
	return s.finalized
}

// Render returns the current display text. Before finalization this is the
// raw accumulated text; after finalization it is the glamour-rendered Markdown.
func (s *StreamBlock) Render(width int) string {
	if s.finalized {
		return s.rendered
	}
	return s.text.String()
}

// HasContent reports whether any tokens have been accumulated.
func (s *StreamBlock) HasContent() bool {
	return s.text.Len() > 0
}
