// StatusBar: bottom bar showing run progress, step count, token usage
import React from "react";
import { Box, Text } from "ink";

import { theme, formatDuration } from "../theme.js";

export interface StatusBarProps {
  readonly runStatus: "idle" | "running" | "waiting" | "success" | "failed";
  readonly step: number;
  readonly totalTokens: number;
  readonly elapsedMs: number;
}

// Map run status to display color and label
function statusInfo(status: StatusBarProps["runStatus"]): {
  color: string;
  label: string;
} {
  switch (status) {
    case "idle":
      return { color: theme.textDim, label: "idle" };
    case "running":
      return { color: theme.accentBright, label: "running" };
    case "waiting":
      return { color: theme.warning, label: "waiting for permission" };
    case "success":
      return { color: theme.success, label: "complete" };
    case "failed":
      return { color: theme.error, label: "failed" };
  }
}

export function StatusBar({
  runStatus,
  step,
  totalTokens,
  elapsedMs,
}: StatusBarProps): React.JSX.Element {
  const { color, label } = statusInfo(runStatus);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.toolBorder}
      paddingX={1}
    >
      <Box>
        <Box flexGrow={1}>
          <Text color={theme.textMuted}>STATUS</Text>
          <Text color={color}> {label}</Text>
        </Box>
        <Box>
          <Text color={theme.textMuted}>STEP</Text>
          <Text color={theme.textDim}> {String(step)}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text color={theme.textMuted}>TOKENS</Text>
          <Text color={theme.textDim}> {totalTokens.toLocaleString()}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text color={theme.textMuted}>ELAPSED</Text>
          <Text color={theme.textDim}> {formatDuration(elapsedMs)}</Text>
        </Box>
      </Box>
    </Box>
  );
}
