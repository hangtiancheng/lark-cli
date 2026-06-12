// InputBar: text input area for sending messages to the agent
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
  const labelColor = disabled ? theme.textMuted : theme.accent;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color={labelColor} bold>
          {disabled ? "RUNNING" : "INPUT"}
        </Text>
      </Box>
      <Box>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          showCursor={!disabled}
        />
      </Box>
    </Box>
  );
}
