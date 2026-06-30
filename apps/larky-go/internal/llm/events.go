package llm

type StreamEvent interface{ streamEvent() }

type TextDelta struct{ Text string }
type ThinkingDelta struct{ Text string }
type ThinkingComplete struct {
	Thinking  string
	Signature string
}
type ToolCallStart struct{ ToolName, ToolID string }
type ToolCallDelta struct{ Text string }
type ToolCallComplete struct {
	ToolID    string
	ToolName  string
	Arguments map[string]any
}
type UsageInfo struct {
	InputTokens  int
	OutputTokens int
	// CacheReadTokens is the number of input tokens served from the prompt
	// cache (Anthropic cache_read_input_tokens; OpenAI
	// prompt_tokens_details.cached_tokens). These are NOT counted in
	// InputTokens by Anthropic, so the true prompt size is
	// InputTokens + CacheReadTokens + CacheCreationTokens.
	CacheReadTokens int
	// CacheCreationTokens is the number of input tokens written into the
	// prompt cache this turn (Anthropic cache_creation_input_tokens). Zero
	// for providers that don't report it.
	CacheCreationTokens int
}

type StreamEnd struct {
	StopReason string
	Usage      UsageInfo
}

func (TextDelta) streamEvent() {}

func (ThinkingDelta) streamEvent() {}

func (ThinkingComplete) streamEvent() {}
func (ToolCallStart) streamEvent()    {}
func (ToolCallDelta) streamEvent()    {}

func (ToolCallComplete) streamEvent() {}

func (StreamEnd) streamEvent() {}
