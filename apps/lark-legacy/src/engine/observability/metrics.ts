export type AiMetricInput = Readonly<{
  modelRole: string;
  status: "success" | "error";
}>;

export type MetricsService = Readonly<{
  recordAiRequest: (input: AiMetricInput) => void;
  recordAiError: (input: { errorType: string; modelRole: string }) => void;
  recordAiResponseTime: (input: { durationMs: number; modelRole: string }) => void;
  recordAiTokenUsage: (input: {
    modelRole: string;
    tokenType: "input" | "output";
    tokens: number;
  }) => void;
  summary: () => MetricsSummary;
}>;

export type MetricsSummary = {
  totalRequests: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  byRole: Record<string, RoleMetrics>;
};

export type RoleMetrics = {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

const emptyRoleMetrics = (): RoleMetrics => ({
  requests: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
});

export const createMetricsService = (): MetricsService => {
  const roles = new Map<string, RoleMetrics>();

  const getRole = (role: string): RoleMetrics => {
    let m = roles.get(role);
    if (!m) {
      m = emptyRoleMetrics();
      roles.set(role, m);
    }
    return m;
  };

  return {
    recordAiRequest: (input) => {
      const m = getRole(input.modelRole);
      m.requests++;
      if (input.status === "error") m.errors++;
    },
    recordAiError: (input) => {
      getRole(input.modelRole).errors++;
    },
    recordAiResponseTime: (input) => {
      getRole(input.modelRole).durationMs += input.durationMs;
    },
    recordAiTokenUsage: (input) => {
      const m = getRole(input.modelRole);
      if (input.tokenType === "input") {
        m.inputTokens += input.tokens;
      } else {
        m.outputTokens += input.tokens;
      }
    },
    summary: () => {
      let totalRequests = 0;
      let totalErrors = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalDurationMs = 0;
      const byRole: Record<string, RoleMetrics> = {};
      for (const [role, m] of roles) {
        byRole[role] = { ...m };
        totalRequests += m.requests;
        totalErrors += m.errors;
        totalInputTokens += m.inputTokens;
        totalOutputTokens += m.outputTokens;
        totalDurationMs += m.durationMs;
      }
      return {
        totalRequests,
        totalErrors,
        totalInputTokens,
        totalOutputTokens,
        totalDurationMs,
        byRole,
      };
    },
  };
};

export const formatSummary = (s: MetricsSummary): string => {
  const lines: string[] = [];
  lines.push(`Requests: ${s.totalRequests} (${s.totalErrors} errors)`);
  lines.push(`Tokens: ${s.totalInputTokens} in / ${s.totalOutputTokens} out`);
  if (s.totalDurationMs > 0) {
    lines.push(`Duration: ${(s.totalDurationMs / 1000).toFixed(1)}s`);
  }
  for (const [role, m] of Object.entries(s.byRole)) {
    lines.push(
      `  ${role}: ${m.requests} req, ${m.inputTokens}+${m.outputTokens} tok, ${(m.durationMs / 1000).toFixed(1)}s`,
    );
  }
  return lines.join("\n");
};
