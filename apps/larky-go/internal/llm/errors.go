package llm

type LLMError struct {
	Message string
}

func (e *LLMError) Error() string { return e.Message }

type AuthenticationError struct {
	Message string
}

func (e *AuthenticationError) Error() string { return e.Message }

type RateLimitError struct {
	Message    string
	RetryAfter string
}

func (e *RateLimitError) Error() string { return e.Message }

type NetworkError struct {
	Message string
}

func (e *NetworkError) Error() string { return e.Message }

type ContextTooLongError struct {
	Message string
}

func (e *ContextTooLongError) Error() string { return e.Message }
