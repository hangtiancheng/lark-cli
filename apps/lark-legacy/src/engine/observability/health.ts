export type HealthStatus = "down" | "up";

export type HealthCheck = Readonly<{
  name: string;
  probe: () => Promise<HealthStatus>;
}>;

export type HealthReport = Readonly<{
  checks: Readonly<Record<string, HealthStatus>>;
  status: HealthStatus;
}>;

export type HealthService = Readonly<{
  check: () => Promise<HealthReport>;
}>;

export const createHealthService = (checks: readonly HealthCheck[] = []): HealthService => ({
  check: async () => {
    const entries = await Promise.all(
      checks.map(async (c): Promise<[string, HealthStatus]> => [c.name, await c.probe()]),
    );
    const result: Record<string, HealthStatus> = {};
    for (const [name, status] of entries) {
      result[name] = status;
    }
    return {
      checks: result,
      status: Object.values(result).every((s) => s === "up") ? "up" : "down",
    };
  },
});

export const createOllamaHealthCheck = (baseUrl: string): HealthCheck => ({
  name: "modelProvider",
  probe: async () => {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok ? "up" : "down";
    } catch {
      return "down";
    }
  },
});
