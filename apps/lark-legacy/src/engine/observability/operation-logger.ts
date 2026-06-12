export type OperationLog = Readonly<{
  durationMs: number;
  operation: string;
  status: "error" | "success";
  timestamp: number;
}>;

export type OperationLogger = Readonly<{
  log: (entry: Omit<OperationLog, "timestamp">) => void;
  entries: () => readonly OperationLog[];
}>;

export const createOperationLogger = (): OperationLogger => {
  const logs: OperationLog[] = [];

  return {
    log: (entry) => {
      logs.push({ ...entry, timestamp: Date.now() });
    },
    entries: () => [...logs],
  };
};
