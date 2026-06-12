import { Box, Text } from "ink";
import MessageItem from "./message-item.js";

interface DisplayMessage {
  isUser: boolean;
  content: string;
  streaming?: boolean;
}

interface MessageListProps {
  messages: DisplayMessage[];
}

export default function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Text color="gray">Type /help for available commands.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <Box key={i} marginBottom={1}>
          <MessageItem isUser={msg.isUser} content={msg.content} streaming={msg.streaming} />
        </Box>
      ))}
    </Box>
  );
}
