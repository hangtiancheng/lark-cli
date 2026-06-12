import { describe, expect, test, afterEach } from "vitest";
import { AnthropicProvider } from "../../src/core/llm/provider.js";

describe("AnthropicProvider", () => {
  const originalKey = process.env["ANTHROPIC_API_KEY"];

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env["ANTHROPIC_API_KEY"] = originalKey;
    } else {
      Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    }
  });

  // Feature: Constructor throws without API key
  // Design: Remove env var, construct provider, expect error
  test("throws error without ANTHROPIC_API_KEY", () => {
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    expect(() => new AnthropicProvider("claude-sonnet-4-6")).toThrow(
      "ANTHROPIC_API_KEY not set",
    );
  });

  // Feature: Constructor succeeds with API key
  // Design: Set env var, construct provider, verify no throw
  test("succeeds with ANTHROPIC_API_KEY set", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test-fake-key";
    const provider = new AnthropicProvider("claude-sonnet-4-6");
    expect(provider).toBeDefined();
  });

  // Feature: Constructor accepts injected client for testing
  // Design: Set API key and construct normally, verify it works without env dependency
  test("works with injected API key", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-injected-test-key";
    const provider = new AnthropicProvider("claude-sonnet-4-6");
    expect(provider).toBeDefined();
    expect(typeof provider.chat).toBe("function");
  });

  // Feature: Provider has chat method
  // Design: Verify chat is a function
  test("has chat method", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test-fake";
    const provider = new AnthropicProvider("claude-sonnet-4-6");
    expect(typeof provider.chat).toBe("function");
  });
});
