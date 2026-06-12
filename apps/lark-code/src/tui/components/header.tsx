// Header: brand, connection status, version — the top banner of the TUI
import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface HeaderProps {
  readonly version: string;
  readonly connected: boolean;
  readonly sessionTitle?: string;
}

export function Header({
  version,
  connected,
  sessionTitle,
}: HeaderProps): React.JSX.Element {
  const statusDot = connected ? "●" : "○";
  const statusColor = connected ? theme.success : theme.error;
  const statusLabel = connected ? "connected" : "disconnected";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text color={theme.accent} bold>
            LARK
          </Text>
          <Text color={theme.textDim}> {version}</Text>
        </Box>
        <Box>
          <Text color={statusColor}>{statusDot}</Text>
          <Text color={theme.textDim}> {statusLabel}</Text>
        </Box>
      </Box>
      {sessionTitle ? (
        <Box>
          <Text color={theme.textMuted}>─</Text>
          <Text color={theme.textDim}> {sessionTitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
