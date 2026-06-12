import { CliError, ErrorCode } from "../errors.js";
import type { RateLimitStore } from "./rate-limit-store.js";

export type RateLimitConfig = Readonly<{
  maxRequests: number;
  namespace: string;
  windowSeconds: number;
}>;

export type RateLimiter = Readonly<{
  consume: (identity: string) => Promise<void>;
}>;

export const createRateLimiter = (store: RateLimitStore, config: RateLimitConfig): RateLimiter => ({
  consume: async (identity) => {
    const key = `rate_limit:${config.namespace}:${identity}`;
    const count = await store.increment(key, config.windowSeconds);
    if (count > config.maxRequests) {
      throw new CliError(ErrorCode.OperationError, "Too many requests, please try again later");
    }
  },
});
