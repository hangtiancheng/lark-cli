// ToolUseCard: inline tool execution indicator — Claude Code style
// No border boxes, just a compact line: icon toolName params duration
// Supports expand/collapse for full params and output
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
  readonly onToggle?: () => void;
  readonly isSubagent?: boolean;
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

// Render full params as pretty-printed JSON
function paramsFull(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";
  return JSON.stringify(params, null, 2);
}

export function ToolUseCard({
  toolName,
  status,
  elapsedMs,
  params,
  output,
  errorMessage,
  expanded,
  onToggle,
  isSubagent,
}: ToolUseCardProps): React.JSX.Element {
  const { icon, iconColor } = toolStatusStyle(status);
  const preview = paramsPreview(params);
  const duration = elapsedMs !== undefined ? formatDuration(elapsedMs) : "";

  // note_save special rendering: show "remembered" instead of generic output
  if (toolName === "note_save" && status === "success") {
    return (
      <Box marginLeft={isSubagent ? 6 : 2}>
        <Text color={theme.success}>{theme.indicator.toolSuccess} remembered</Text>
        {duration ? <Text color={theme.textMuted}> {duration}</Text> : null}
      </Box>
    );
  }

  // Auto-expand running tools; respect explicit expanded prop for completed tools
  const isExpanded = expanded ?? status === "running";
  const hasOutput =
    status === "success"
      ? (output ?? "").length > 0
      : status === "failed" && (errorMessage ?? "").length > 0;
  const fullParams = paramsFull(params);
  const fullOutput = status === "failed" ? (errorMessage ?? "") : (output ?? "");
  const marginLeft = isSubagent ? 6 : 2;

  return (
    <Box flexDirection="column" marginLeft={marginLeft}>
      {/* Main tool indicator line */}
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text color={theme.toolName}>{toolName}</Text>
        {!isExpanded && preview ? (
          <Text color={theme.textDim}> {truncate(preview, 50)}</Text>
        ) : null}
        {duration ? <Text color={theme.textMuted}> {duration}</Text> : null}
        {!isExpanded && hasOutput && onToggle ? (
          <Text color={theme.textMuted}> (Tab to expand)</Text>
        ) : null}
      </Box>

      {/* Expanded view: full params + output */}
      {isExpanded ? (
        <Box flexDirection="column" marginLeft={2}>
          {fullParams ? (
            <Box flexDirection="column">
              <Text color={theme.textDim}>params:</Text>
              <Text color={theme.text}>{fullParams}</Text>
            </Box>
          ) : null}
          {fullOutput ? (
            <Box flexDirection="column">
              <Text color={theme.textDim}>{status === "failed" ? "error:" : "output:"}</Text>
              <Text color={status === "failed" ? theme.error : theme.text} wrap="wrap">
                {fullOutput}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
