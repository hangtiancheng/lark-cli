// InputBar: text input area — Claude Code style, minimal chrome
// Single-line border with accent color, compact label, no double borders
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

import { theme } from "../theme.js";

export interface InputBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly disabled: boolean;
  readonly placeholder?: string;
}

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = "Type a message…",
}: InputBarProps): React.JSX.Element {
  const borderColor = disabled ? theme.textMuted : theme.accent;
  const label = disabled ? "running" : "input";

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1}>
      <Text color={borderColor} bold>
        {label}{" "}
      </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        showCursor={!disabled}
      />
    </Box>
  );
}
