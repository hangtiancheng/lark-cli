import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputBoxProps {
  disabled: boolean;
  onSubmit: (value: string) => void;
}

export default function InputBox({ disabled, onSubmit }: InputBoxProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.ctrl) return;
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue("");
        setCursor(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor((c) => c - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev.slice(0, cursor) + input + prev.slice(cursor));
      setCursor((c) => c + input.length);
    }
  });

  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box borderStyle="round" borderColor={disabled ? "gray" : "green"} paddingX={1}>
      <Text color="green">&gt; </Text>
      {disabled ? (
        <Text color="gray">Waiting for response...</Text>
      ) : (
        <Text>
          {before}
          <Text inverse>{cursorChar}</Text>
          {after}
        </Text>
      )}
    </Box>
  );
}
