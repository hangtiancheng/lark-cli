import { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface SelectListProps {
  title: string;
  options: SelectOption[];
  defaultValue?: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export default function SelectList({
  title,
  options,
  defaultValue,
  onSelect,
  onCancel,
}: SelectListProps) {
  const defaultIndex = defaultValue
    ? Math.max(
        options.findIndex((o) => o.value === defaultValue),
        0,
      )
    : 0;
  const [cursor, setCursor] = useState(defaultIndex);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const selected = options[cursor];
      if (selected) onSelect(selected.value);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : options.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < options.length - 1 ? c + 1 : 0));
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green">{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, i) => {
          const active = i === cursor;
          return (
            <Box key={option.value}>
              <Text color={active ? "green" : "gray"}>{active ? "> " : "  "}</Text>
              <Text color={active ? "white" : "gray"}>{option.label}</Text>
              {option.description && <Text dimColor> ({option.description})</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Use arrow keys to navigate, Enter to select, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
