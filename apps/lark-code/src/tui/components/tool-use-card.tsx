// ToolCallCard: renders a tool execution as a bordered card with progress bar
import React from "react";
import { Box, Text } from "ink";

import { theme, formatDuration, truncate } from "../theme.js";

export interface ToolUseCardProps {
  readonly toolName: string;
  readonly status: "running" | "success" | "failed";
  readonly elapsedMs?: number;
  readonly params?: Record<string, unknown>;
  readonly output?: string;
  readonly errorMessage?: string;
}

// Map tool status to border color and status indicator
function toolStatusStyle(status: ToolUseCardProps["status"]): {
  borderColor: string;
  icon: string;
  iconColor: string;
} {
  switch (status) {
    case "running":
      return {
        borderColor: theme.accent,
        icon: "◐",
        iconColor: theme.accentBright,
      };
    case "success":
      return {
        borderColor: theme.success,
        icon: "✓",
        iconColor: theme.success,
      };
    case "failed":
      return {
        borderColor: theme.error,
        icon: "✗",
        iconColor: theme.error,
      };
  }
}

// Build a compact params preview string
function paramsPreview(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";
  const entries = Object.entries(params).slice(0, 3);
  return entries
    .map(([key, val]) => {
      const v =
        typeof val === "string" ? truncate(val, 30) : JSON.stringify(val);
      return `${key}=${v}`;
    })
    .join(" ");
}

export function ToolUseCard({
  toolName,
  status,
  elapsedMs,
  params,
  output,
  errorMessage,
}: ToolUseCardProps): React.JSX.Element {
  const { borderColor, icon, iconColor } = toolStatusStyle(status);
  const preview = paramsPreview(params);
  const duration = elapsedMs !== undefined ? formatDuration(elapsedMs) : "…";

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
      marginLeft={2}
    >
      <Box>
        <Text color={iconColor}>{icon}</Text>
        <Text color={theme.accent} bold>
          {toolName}
        </Text>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text color={theme.textMuted}>{duration}</Text>
        </Box>
      </Box>
      {preview ? (
        <Box>
          <Text color={theme.textDim}>{truncate(preview, 60)}</Text>
        </Box>
      ) : null}
      {status === "running" ? (
        <Box>
          <Text color={theme.accent}>
            {"▸"}
            {"░".repeat(20)}
          </Text>
        </Box>
      ) : null}
      {status === "success" && output ? (
        <Box>
          <Text color={theme.textDim}>{truncate(output, 120)}</Text>
        </Box>
      ) : null}
      {status === "failed" && errorMessage ? (
        <Box>
          <Text color={theme.error}>{truncate(errorMessage, 120)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
