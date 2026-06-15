// InputBar: text input area with multi-line support
// Enter submits; Alt+Enter or Shift+Enter inserts newline
// Claude Code style: minimal chrome, single border, accent color
import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";

import { theme } from "../theme.js";

export interface InputBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly disabled: boolean;
  readonly placeholder?: string;
  readonly label?: string;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Type a message...",
  label,
}: InputBarProps): React.JSX.Element {
  const borderColor = disabled ? theme.textMuted : theme.accent;
  const displayLabel = label ?? (disabled ? "running" : "input");

  useInput(
    useCallback(
      (input, key) => {
        if (disabled) return;

        // Enter: submit (plain Enter without modifiers)
        if (key.return && !key.shift && !key.meta && !key.ctrl) {
          if (value.trim().length > 0) {
            onSubmit(value);
          }
          return;
        }

        // Alt+Enter or Shift+Enter: insert newline
        if (key.return && (key.shift || key.meta)) {
          onChange(value + "\n");
          return;
        }

        // Backspace: remove last character
        if (key.backspace || key.delete) {
          onChange(value.slice(0, -1));
          return;
        }

        // Ctrl+C / Ctrl+D: let the parent handle these
        if (key.ctrl && (input === "c" || input === "d")) {
          return;
        }

        // Ctrl+L: let the parent handle screen clear
        if (key.ctrl && input === "l") {
          return;
        }

        // Tab: insert spaces
        if (key.tab) {
          onChange(value + "  ");
          return;
        }

        // Regular printable characters
        if (input && !key.ctrl && !key.meta) {
          onChange(value + input);
        }
      },
      [disabled, value, onChange, onSubmit],
    ),
  );

  const lines = value.length > 0 ? value.split("\n") : [];
  const hasContent = lines.length > 0;

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1} flexDirection="column">
      <Box>
        <Text color={borderColor} bold>
          {displayLabel}{" "}
        </Text>
      </Box>
      {hasContent ? (
        <Box flexDirection="column">
          {lines.map((line, idx) => (
            <Text key={String(idx)} wrap="wrap">
              {line}
              {idx === lines.length - 1 && !disabled ? (
                <Text backgroundColor={theme.accent}> </Text>
              ) : null}
            </Text>
          ))}
        </Box>
      ) : (
        <Text color={theme.textMuted}>
          {placeholder}
          {!disabled ? <Text backgroundColor={theme.accent}> </Text> : null}
        </Text>
      )}
    </Box>
  );
}
