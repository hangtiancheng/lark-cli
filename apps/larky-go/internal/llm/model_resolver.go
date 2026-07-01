package llm

import "larky/internal/config"

var modelAliases = map[string]string{

	"haiku":  "claude-haiku-4-5-20251001",
	"sonnet": "claude-sonnet-4-6-20250514",
	"opus":   "claude-opus-4-6-20250514",
}

func NewModelResolver(baseCfg config.ProviderConfig) func(string) (Client, error) {
	return func(shortName string) (Client, error) {
		modelID, ok := modelAliases[shortName]
		if !ok {
			modelID = shortName
		}

		cfg := baseCfg
		cfg.Model = modelID
		return NewClient(&cfg, "")
	}
}
