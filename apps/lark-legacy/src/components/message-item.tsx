import { useMemo } from "react";
import { Box, Text } from "ink";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

const marked = new Marked(markedTerminal() as Parameters<typeof Marked.prototype.use>[0]);

function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text);
    if (typeof rendered !== "string") return text;
    return rendered.replace(/\n$/, "");
  } catch {
    return text;
  }
}

interface MessageItemProps {
  isUser: boolean;
  content: string;
  streaming?: boolean;
}

export default function MessageItem({ isUser, content, streaming }: MessageItemProps) {
  const rendered = useMemo(() => {
    if (isUser || streaming) return content;
    return renderMarkdown(content);
  }, [isUser, content, streaming]);

  if (isUser) {
    return (
      <Box flexDirection="row" marginY={0}>
        <Text color="green">You: </Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginY={0}>
      <Text color="greenBright">AI: </Text>
      <Box>
        <Text>
          {rendered}
          {streaming ? "▌" : ""}
        </Text>
      </Box>
    </Box>
  );
}
