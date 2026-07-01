package llm

import (
	"context"
	"fmt"

	"larky/internal/config"
	"larky/internal/conversation"
)

type Client interface {
	Stream(ctx context.Context, conv *conversation.Manager, tools []map[string]any) (<-chan StreamEvent, <-chan error)
}

type MaxTokensSetter interface {
	SetMaxOutputTokens(tokens int)
}

func NewClient(cfg *config.ProviderConfig, systemPrompt string) (Client, error) {
	switch cfg.Protocol {
	case "anthropic":
		return newAnthropicClient(cfg, systemPrompt)
	case "openai":
		return newOpenAIClient(cfg, systemPrompt)
	case "openai-compat":
		return newOpenAICompatClient(cfg, systemPrompt)
	default:
		return nil, fmt.Errorf("unknown protocol: %s", cfg.Protocol)
	}
}

// contextWindowFetcher is implemented by clients that can pull the model's
// context window from their provider. Only the Anthropic client does so.
type contextWindowFetcher interface {
	FetchModelContextWindow(ctx context.Context) int
}

// ResolveContextWindow performs layer 2 of context-window resolution: for
// Anthropic-protocol providers it pulls the model's max_input_tokens from
// {base_url}/v1/models/{model} once and caches it on cfg via
// SetFetchedContextWindow, so later cfg.GetContextWindow() calls use it
// without hitting the network again.
//
// It is fully best-effort and never returns an error: a non-Anthropic
// provider, a client-construction failure, or a failed/timed-out fetch all
// leave the cache untouched, letting GetContextWindow fall back to the
// built-in mapping table / default. Safe to call at startup — it will not
// block beyond the fetch's own timeout and will not panic.
func ResolveContextWindow(ctx context.Context, cfg *config.ProviderConfig) {
	// An explicit config value already wins in GetContextWindow, so there's
	// nothing to fetch. Likewise skip if we've already cached a value.
	if cfg == nil || cfg.ContextWindow > 0 {
		return
	}
	if cfg.Protocol != "anthropic" {
		return
	}

	client, err := NewClient(cfg, "")
	if err != nil {
		return
	}
	fetcher, ok := client.(contextWindowFetcher)
	if !ok {
		return
	}
	if window := fetcher.FetchModelContextWindow(ctx); window > 0 {
		cfg.SetFetchedContextWindow(window)
	}
}
