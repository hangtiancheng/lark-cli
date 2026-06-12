import { useCallback } from "react";
import { Box, Text } from "ink";
import StatusBar from "./status-bar.js";
import MessageList from "./message-list.js";
import InputBox from "./input-box.js";
import type { ModelType } from "../types.js";
import type { DisplayMessage } from "../commands/command-handler.js";

interface ChatViewProps {
  sessionTitle: string | null;
  model: ModelType;
  messages: DisplayMessage[];
  notification: string | null;
  onSendMessage: (message: string) => Promise<void>;
  onCommand: (cmd: string, args: string) => void;
  loading: boolean;
  streaming: boolean;
}

export default function ChatView({
  sessionTitle,
  model,
  messages,
  notification,
  onSendMessage,
  onCommand,
  loading,
  streaming,
}: ChatViewProps) {
  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith("/")) {
        const spaceIdx = input.indexOf(" ");
        const cmd = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
        const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();
        onCommand(cmd, args);
        return;
      }
      await onSendMessage(input);
    },
    [onSendMessage, onCommand],
  );

  return (
    <Box flexDirection="column" width="100%">
      <StatusBar
        sessionTitle={sessionTitle}
        model={model}
        loading={loading}
        streaming={streaming}
      />

      {notification && (
        <Box paddingX={1}>
          <Text color="yellow">{notification}</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <MessageList messages={messages} />
      </Box>

      <InputBox disabled={loading} onSubmit={handleSubmit} />
    </Box>
  );
}
