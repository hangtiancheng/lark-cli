// SlashCompletePopup: autocomplete popup for slash commands
// Shows available commands (builtin + skills) with keyboard navigation
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

import { theme, truncate } from "../theme.js";

interface Command {
  name: string;
  description: string;
}

export interface SlashCompletePopupProps {
  readonly commands: readonly Command[];
  readonly filter: string;
  readonly onSelect: (command: Command) => void;
  readonly onCancel: () => void;
}

export function SlashCompletePopup({
  commands,
  filter,
  onSelect,
  onCancel,
}: SlashCompletePopupProps): React.JSX.Element | null {
  const [cursor, setCursor] = useState(0);

  // Filter commands based on input
  const filtered = commands.filter((cmd) => {
    const lowerFilter = filter.toLowerCase();
    const lowerName = cmd.name.toLowerCase();
    return lowerName.includes(lowerFilter);
  });

  // Reset cursor when filter changes
  useEffect(() => {
    setCursor(0);
  }, [filter]);

  // Handle keyboard navigation
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }

    if (input === "\r" || input === "\n") {
      if (filtered.length > 0 && cursor < filtered.length) {
        const selected = filtered[cursor];
        onSelect(selected);
      }
    }
  });

  if (filtered.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.accent}
      paddingX={1}
      marginBottom={1}
    >
      {filtered.slice(0, 10).map((cmd, i) => (
        <Box key={cmd.name}>
          {i === cursor ? (
            <>
              <Text color={theme.accentBright} bold>
                ❯ /{cmd.name}
              </Text>
              <Text color={theme.textMuted}> {truncate(cmd.description, 50)}</Text>
            </>
          ) : (
            <>
              <Text color={theme.text}> /{cmd.name}</Text>
              <Text color={theme.textMuted}> {truncate(cmd.description, 50)}</Text>
            </>
          )}
        </Box>
      ))}
      {filtered.length > 10 ? (
        <Text color={theme.textMuted}> ... and {String(filtered.length - 10)} more</Text>
      ) : null}
      <Text color={theme.textDim}> ↑↓ navigate enter confirm esc cancel</Text>
    </Box>
  );
}
