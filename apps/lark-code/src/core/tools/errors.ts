// Tool-related custom errors
export class RateLimitedError extends Error {
  constructor(message?: string) {
    super(message ?? "Rate limited");
    this.name = "RateLimitedError";
  }
}
