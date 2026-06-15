// ToolUseCard: inline tool execution indicator — Claude Code style
// No border boxes, just a compact line: icon toolName params duration
// Success/failure output shown as continuation text below when expanded
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
  readonly expanded?: boolean;
}

// Map tool status to icon and color
function toolStatusStyle(status: ToolUseCardProps["status"]): {
  icon: string;
  iconColor: string;
} {
  switch (status) {
    case "running":
      return {
        icon: theme.indicator.toolRunning,
        iconColor: theme.toolRunning,
      };
    case "success":
      return {
        icon: theme.indicator.toolSuccess,
        iconColor: theme.toolSuccess,
      };
    case "failed":
      return { icon: theme.indicator.toolFailed, iconColor: theme.toolFailed };
  }
}

// Build a compact params preview string (max 3 key=value pairs)
function paramsPreview(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";
  const entries = Object.entries(params).slice(0, 3);
  return entries
    .map(([key, val]) => {
      const v = typeof val === "string" ? truncate(val, 30) : JSON.stringify(val);
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
  expanded,
}: ToolUseCardProps): React.JSX.Element {
  const { icon, iconColor } = toolStatusStyle(status);
  const preview = paramsPreview(params);
  const duration = elapsedMs !== undefined ? formatDuration(elapsedMs) : "";

  // Auto-expand running tools, respect explicit expanded prop for completed tools
  const isExpanded = expanded ?? status === "running";

  return (
    <Box flexDirection="column" marginLeft={2}>
      {/* Main tool indicator line */}
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text color={theme.toolName}>{toolName}</Text>
        {isExpanded && preview ? <Text color={theme.textDim}> {truncate(preview, 50)}</Text> : null}
        {duration ? <Text color={theme.textMuted}> {duration}</Text> : null}
      </Box>

      {/* Output continuation (compact, no borders) - only when expanded */}
      {isExpanded && status === "success" && output ? (
        <Box marginLeft={3}>
          <Text color={theme.textDim}>{truncate(output, 120)}</Text>
        </Box>
      ) : null}
      {isExpanded && status === "failed" && errorMessage ? (
        <Box marginLeft={3}>
          <Text color={theme.error}>{truncate(errorMessage, 120)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
