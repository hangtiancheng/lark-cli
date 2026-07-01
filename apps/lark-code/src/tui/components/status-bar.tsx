// StatusBar: compact inline status — Claude Code style, no borders
// Shows: status label | step | tokens | elapsed | context% — all in one line
import React from "react";
import { Box, Text } from "ink";

import { theme, formatDuration, contextBarFill, contextBarColor } from "../theme.js";

export interface StatusBarProps {
  readonly runStatus: "idle" | "running" | "waiting" | "success" | "failed";
  readonly step: number;
  readonly totalTokens: number;
  readonly elapsedMs: number;
  readonly contextPercent?: number;
}

// Map run status to display color and label
function statusInfo(status: StatusBarProps["runStatus"]): {
  color: string;
  label: string;
  icon: string;
} {
  switch (status) {
    case "idle":
      return {
        color: theme.textDim,
        label: "idle",
        icon: theme.indicator.bullet,
      };
    case "running":
      return {
        color: theme.accentBright,
        label: "running",
        icon: theme.indicator.toolRunning,
      };
    case "waiting":
      return {
        color: theme.warning,
        label: "waiting",
        icon: theme.indicator.permission,
      };
    case "success":
      return {
        color: theme.success,
        label: "done",
        icon: theme.indicator.toolSuccess,
      };
    case "failed":
      return {
        color: theme.error,
        label: "failed",
        icon: theme.indicator.toolFailed,
      };
  }
}

export function StatusBar({
  runStatus,
  step,
  totalTokens,
  elapsedMs,
  contextPercent,
}: StatusBarProps): React.JSX.Element {
  const { color, label, icon } = statusInfo(runStatus);
  const ctxPctNum = contextPercent ?? 0;
  const ctxPctLabel = ctxPctNum > 0 ? `${(ctxPctNum * 100).toFixed(1)}%` : "";
  const ctxColor = contextBarColor(ctxPctNum);
  const ctxBar = ctxPctNum > 0 ? contextBarFill(ctxPctNum) : "";

  return (
    <Box paddingX={1}>
      <Text color={color}>
        {icon} {label}
      </Text>
      {step > 0 ? <Text color={theme.textDim}> step:{String(step)}</Text> : null}
      {totalTokens > 0 ? (
        <Text color={theme.textDim}> tok:{totalTokens.toLocaleString()}</Text>
      ) : null}
      {elapsedMs > 0 ? <Text color={theme.textDim}> {formatDuration(elapsedMs)}</Text> : null}
      {ctxPctLabel ? (
        <>
          <Text color={theme.textMuted}> ctx:{ctxPctLabel} </Text>
          <Text color={ctxColor} bold={ctxPctNum >= 0.85}>
            {ctxBar}
          </Text>
        </>
      ) : null}
    </Box>
  );
}
