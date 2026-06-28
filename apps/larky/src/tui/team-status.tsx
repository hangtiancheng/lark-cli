import { Text } from "ink";

interface TeamStatusProps {
  count: number; // number of active teammates
}

export function TeamStatus({ count }: TeamStatusProps) {
  if (count === 0) {
    return null;
  }

  const label = count === 1 ? "teammate" : "teammates";

  return (
    <Text dimColor>
      <Text color="magenta">●</Text> {count} {label}
    </Text>
  );
}
