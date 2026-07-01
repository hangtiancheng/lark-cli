// Header: minimal top banner — brand + connection dot + host:port + session label
// Claude Code style: one compact line, no borders, no heavy chrome
import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface HeaderProps {
  readonly version: string;
  readonly connected: boolean;
  readonly sessionTitle?: string;
  readonly errorMessage?: string | null;
  readonly host?: string;
  readonly port?: number;
  readonly step?: number;
}

export function Header({
  version,
  connected,
  sessionTitle,
  errorMessage,
  host,
  port,
  step,
}: HeaderProps): React.JSX.Element {
  const dot = connected ? theme.indicator.session : "○";
  const dotColor = connected ? theme.success : theme.error;
  const statusLabel = connected ? "ready" : "offline";
  const statusColor = connected ? theme.success : theme.error;

  return (
    <Box paddingX={1} marginBottom={0}>
      <Text color={theme.accent} bold>
        lark
      </Text>
      <Text color={theme.textDim}> v{version}</Text>
      <Text color={dotColor}> {dot}</Text>
      <Text color={statusColor}> {statusLabel}</Text>
      {host && port ? (
        <Text color={theme.textMuted}>
          {" "}
          {host}:{String(port)}
        </Text>
      ) : null}
      {sessionTitle ? <Text color={theme.textMuted}> {sessionTitle}</Text> : null}
      {step && step > 0 ? <Text color={theme.textDim}> step:{String(step)}</Text> : null}
      <Box flexGrow={1}>
        <Text color={theme.textMuted}> {theme.indicator.thinDash.repeat(2)}</Text>
      </Box>
      {errorMessage ? <Text color={theme.error}> err:{errorMessage}</Text> : null}
    </Box>
  );
}
