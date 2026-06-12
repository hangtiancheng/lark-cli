import { Box, Text } from "ink";
import type { ModelType } from "../types.js";

interface StatusBarProps {
  sessionTitle: string | null;
  model: ModelType;
  loading: boolean;
  streaming: boolean;
}

export default function StatusBar({ sessionTitle, model, loading, streaming }: StatusBarProps) {
  return (
    <Box flexDirection="row" paddingX={1} borderStyle="single" borderColor="green">
      <Text color="green">lark-cli</Text>
      <Text color="gray"> | </Text>
      <Text color="green">{model}</Text>
      <Text color="gray"> | </Text>
      <Text color={streaming ? "green" : "gray"}>{streaming ? "sse" : "sync"}</Text>
      <Text color="gray"> | </Text>
      <Text dimColor>{sessionTitle || "New Chat"}</Text>
      {loading && (
        <>
          <Text color="gray"> | </Text>
          <Text color="greenBright">Generating...</Text>
        </>
      )}
    </Box>
  );
}
