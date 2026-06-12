export type RateLimitStore = Readonly<{
  increment: (key: string, windowSeconds: number) => Promise<number>;
}>;

export const createInMemoryRateLimitStore = (): RateLimitStore => {
  const values = new Map<string, { count: number; expiresAt: number }>();

  return {
    increment: async (key, windowSeconds) => {
      const now = Date.now();
      const current = values.get(key);
      if (current === undefined || current.expiresAt <= now) {
        values.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return 1;
      }
      const next = current.count + 1;
      values.set(key, { count: next, expiresAt: current.expiresAt });
      return next;
    },
  };
};
