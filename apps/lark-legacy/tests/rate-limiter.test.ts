import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createInMemoryRateLimitStore, createRateLimiter } from "../src/engine/rate-limit/index.js";

describe("createInMemoryRateLimitStore", () => {
  test("returns 1 on first increment", async () => {
    const store = createInMemoryRateLimitStore();
    const count = await store.increment("key1", 60);
    expect(count).toBe(1);
  });

  test("increments count within window", async () => {
    const store = createInMemoryRateLimitStore();
    await store.increment("key1", 60);
    const count = await store.increment("key1", 60);
    expect(count).toBe(2);
  });

  test("tracks keys independently", async () => {
    const store = createInMemoryRateLimitStore();
    await store.increment("key1", 60);
    await store.increment("key1", 60);
    const count = await store.increment("key2", 60);
    expect(count).toBe(1);
  });

  test("resets count after window expires", async () => {
    vi.useFakeTimers();
    const store = createInMemoryRateLimitStore();
    await store.increment("key1", 1);
    await store.increment("key1", 1);

    vi.advanceTimersByTime(1100);

    const count = await store.increment("key1", 1);
    expect(count).toBe(1);
    vi.useRealTimers();
  });
});

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("allows requests within limit", async () => {
    const store = createInMemoryRateLimitStore();
    const limiter = createRateLimiter(store, {
      namespace: "test",
      maxRequests: 3,
      windowSeconds: 60,
    });

    await expect(limiter.consume("user1")).resolves.toBeUndefined();
    await expect(limiter.consume("user1")).resolves.toBeUndefined();
    await expect(limiter.consume("user1")).resolves.toBeUndefined();
  });

  test("rejects requests over limit", async () => {
    const store = createInMemoryRateLimitStore();
    const limiter = createRateLimiter(store, {
      namespace: "test",
      maxRequests: 2,
      windowSeconds: 60,
    });

    await limiter.consume("user1");
    await limiter.consume("user1");
    await expect(limiter.consume("user1")).rejects.toThrow("Too many requests");
  });

  test("resets after window expires", async () => {
    const store = createInMemoryRateLimitStore();
    const limiter = createRateLimiter(store, {
      namespace: "test",
      maxRequests: 1,
      windowSeconds: 10,
    });

    await limiter.consume("user1");
    await expect(limiter.consume("user1")).rejects.toThrow("Too many requests");

    vi.advanceTimersByTime(11_000);

    await expect(limiter.consume("user1")).resolves.toBeUndefined();
  });

  test("tracks identities independently", async () => {
    const store = createInMemoryRateLimitStore();
    const limiter = createRateLimiter(store, {
      namespace: "test",
      maxRequests: 1,
      windowSeconds: 60,
    });

    await limiter.consume("user1");
    await expect(limiter.consume("user2")).resolves.toBeUndefined();
  });

  test("namespaces are isolated", async () => {
    const store = createInMemoryRateLimitStore();
    const limiterA = createRateLimiter(store, {
      namespace: "chat",
      maxRequests: 1,
      windowSeconds: 60,
    });
    const limiterB = createRateLimiter(store, {
      namespace: "codegen",
      maxRequests: 1,
      windowSeconds: 60,
    });

    await limiterA.consume("user1");
    await expect(limiterB.consume("user1")).resolves.toBeUndefined();
  });
});
