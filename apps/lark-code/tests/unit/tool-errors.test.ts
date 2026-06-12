import { describe, expect, test } from "vitest";
import { RateLimitedError } from "../../src/core/tools/errors.js";

describe("Tool Errors", () => {
  // Feature: Verify RateLimitedError is an instance of Error
  // Design: Create RateLimitedError, confirm it's an Error instance
  test("RateLimitedError is Error instance", () => {
    const error = new RateLimitedError("Rate limited");
    expect(error).toBeInstanceOf(Error);
  });

  // Feature: Verify RateLimitedError has correct name
  // Design: Create RateLimitedError, confirm name is "RateLimitedError"
  test("RateLimitedError has correct name", () => {
    const error = new RateLimitedError("Rate limited");
    expect(error.name).toBe("RateLimitedError");
  });

  // Feature: Verify RateLimitedError preserves message
  // Design: Create RateLimitedError with message, confirm message is preserved
  test("RateLimitedError preserves message", () => {
    const error = new RateLimitedError("Custom rate limit message");
    expect(error.message).toBe("Custom rate limit message");
  });

  // Feature: Verify RateLimitedError can be caught as Error
  // Design: Throw RateLimitedError, catch as Error, confirm it's caught
  test("RateLimitedError can be caught as Error", () => {
    let caught = false;
    try {
      throw new RateLimitedError("Test");
    } catch (e) {
      if (e instanceof Error) {
        caught = true;
      }
    }
    expect(caught).toBe(true);
  });
});
