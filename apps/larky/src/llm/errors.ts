export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

export class AuthenticationError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends LLMError {
  retryAfter?: string | undefined;
  constructor(message: string, retryAfter?: string) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class NetworkError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ContextTooLongError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "ContextTooLongError";
  }
}
