// PermissionPrompt: keyboard-driven permission response overlay
// Claude Code style: inline warning indicator, no double-border box, compact layout
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

import { theme, truncate } from "../theme.js";

export interface PermissionPromptProps {
  readonly toolName: string;
  readonly paramsPreview: string;
  readonly toolUseId: string;
  readonly onRespond: (decision: string) => void;
  readonly visible: boolean;
}

interface Choice {
  decision: string;
  label: string;
  keyHint: string;
}

const CHOICES: readonly Choice[] = [
  { decision: "allow_once", label: "Allow once", keyHint: "y / 1" },
  { decision: "always_allow", label: "Always allow", keyHint: "a / 2" },
  { decision: "deny_once", label: "Deny", keyHint: "n / 3" },
  { decision: "always_deny", label: "Always deny", keyHint: "d / 4" },
];

// Interactive permission overlay with arrow keys, Enter, and shortcuts
export function PermissionPrompt({
  toolName,
  paramsPreview,
  onRespond,
  visible,
}: PermissionPromptProps): React.JSX.Element | null {
  const [cursor, setCursor] = useState(0);

  const handleInput = useCallback(
    (input: string, key: { upArrow?: boolean; downArrow?: boolean }) => {
      if (!visible) return;

      // Arrow key navigation
      if (key.upArrow || input === "k") {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((c) => Math.min(CHOICES.length - 1, c + 1));
        return;
      }

      // Enter to confirm
      if (input === "\r" || input === "\n") {
        onRespond(CHOICES[cursor].decision);
        return;
      }

      // Letter shortcuts
      if (input === "y") onRespond("allow_once");
      else if (input === "a") onRespond("always_allow");
      else if (input === "n") onRespond("deny_once");
      else if (input === "d") onRespond("always_deny");
      // Number shortcuts
      else if (input === "1") onRespond("allow_once");
      else if (input === "2") onRespond("always_allow");
      else if (input === "3") onRespond("deny_once");
      else if (input === "4") onRespond("always_deny");
    },
    [onRespond, visible, cursor],
  );

  useInput((input, key) => {
    handleInput(input, { upArrow: key.upArrow, downArrow: key.downArrow });
  });

  if (!visible) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginY={0}>
      <Box>
        <Text color={theme.warning} bold>
          {theme.indicator.permission} permission required
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={theme.toolName} bold>
          {toolName}
        </Text>
        {paramsPreview ? <Text color={theme.textDim}> {truncate(paramsPreview, 70)}</Text> : null}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {CHOICES.map((choice, i) => (
          <Box key={choice.decision}>
            {i === cursor ? (
              <>
                <Text color={theme.accentBright} bold>
                  ❯ {choice.label}
                </Text>
                <Text color={theme.textMuted}> {choice.keyHint}</Text>
              </>
            ) : (
              <>
                <Text color={theme.text}> {choice.label}</Text>
                <Text color={theme.textMuted}> {choice.keyHint}</Text>
              </>
            )}
          </Box>
        ))}
        <Text color={theme.textMuted}> ↑↓ navigate enter confirm</Text>
      </Box>
    </Box>
  );
}
