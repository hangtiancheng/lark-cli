import { ICONS } from "./styles.js";
import { Box, Text } from "ink";

interface StatusBarProps {
  /** Currently not used */
  model: string;
  mode?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function StatusBar(props: StatusBarProps) {
  const { mode, inputTokens = 0, outputTokens = 0 } = props;
  const parts: string[] = [];
  if (mode) {
    parts.push(mode);
  }
  if (inputTokens > 0) {
    parts.push(`${formatTokens(inputTokens)}↓ ${formatTokens(outputTokens)}↑`);
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <Box paddingLeft={1} paddingTop={0} paddingBottom={0}>
      <Text dimColor>
        {parts.map((p, i) => (i > 0 ? ` ${ICONS.dot} ` : `${ICONS.dot} `) + p).join("")}
      </Text>
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}
