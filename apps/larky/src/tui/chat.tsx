import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "@lark.js/marked-terminal";
import { COLORS, ICONS } from "./styles.js";
import { Box, Text } from "ink";

chalk.level = 3;
marked.use(markedTerminal({ showSectionPrefix: false }));

async function renderMarkdown(text: string): Promise<string> {
  try {
    return await marked.parse(text);
  } catch {
    return text;
  }
}

export interface ToolSummaryItem {
  toolName: string;
  argsSummary: string;
  output: string;
  isError: boolean;
  elapsed: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "thinking" | "tool_use" | "tool_result" | "turn_summary";
  content: string;
  toolName?: string;
  argsSummary?: string;
  isError?: boolean;
  elapsed?: number;
  // turn_summary fields
  thinkingDuration?: number;
  toolSummary?: ToolSummaryItem[];
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingText?: string;
  expanded?: boolean;
}

export function ChatView(props: ChatViewProps) {
  const { messages, streamingText, expanded = false } = props;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} expanded={expanded} />
      ))}
      {streamingText !== undefined && streamingText !== "" && (
        <Box>
          <Text>
            {COLORS.assistant(`${ICONS.dot} `)}
            {renderMarkdown(streamingText)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * CommittedMessage renders a single finalized message for use inside Ink's
 * <Static> component. Once rendered, Static never re-renders it, eliminating
 * flicker from the scrollback history.
 */

interface CommitMessageProps {
  message: ChatMessage;
  expanded?: boolean | undefined;
}
export function CommittedMessage(props: CommitMessageProps) {
  const { message, expanded = false } = props;
  return (
    <Box paddingLeft={1}>
      <MessageBlock message={message} expanded={expanded} />
    </Box>
  );
}

/**
 * Build a compact human-readable summary line for a turn, e.g.:
 *   "Thought for 4s, read 2 files, ran 1 command"
 */
function buildTurnSummaryText(
  thinkingDuration: number | undefined,
  tools: ToolSummaryItem[],
): string {
  const parts: string[] = [];

  if (thinkingDuration !== undefined && thinkingDuration >= 1) {
    parts.push(`Thought for ${String(Math.round(thinkingDuration))}s`);
  }

  if (tools.length > 0) {
    type Key = "read" | "wrote" | "edited" | "ran" | "globbed" | "searched" | "used";
    type Count = Record<Key, number>;
    type Label = Record<keyof Count, (n: number) => string>;

    // Categorize tools by type for a natural summary.
    const counts: Count = {
      read: 0,
      wrote: 0,
      edited: 0,
      ran: 0,
      globbed: 0,
      searched: 0,
      used: 0,
    };

    for (const t of tools) {
      const name = t.toolName;
      if (name === "ReadFile") {
        counts.read = counts.read + 1;
      } else if (name === "WriteFile") {
        counts.wrote = counts.wrote + 1;
      } else if (name === "EditFile") {
        counts.edited = counts.edited + 1;
      } else if (name === "Bash") {
        counts.ran = counts.ran + 1;
      } else if (name === "Glob") {
        counts.globbed = counts.globbed + 1;
      } else if (name === "Grep") {
        counts.searched = counts.searched + 1;
      } else {
        counts.used = counts.used + 1;
      }
    }

    const labels: Label = {
      read: (n) => `read ${String(n)} file${n > 1 ? "s" : ""}`,
      wrote: (n) => `wrote ${String(n)} file${n > 1 ? "s" : ""}`,
      edited: (n) => `edited ${String(n)} file${n > 1 ? "s" : ""}`,
      ran: (n) => `ran ${String(n)} command${n > 1 ? "s" : ""}`,
      globbed: (n) => `globbed ${String(n)} pattern${n > 1 ? "s" : ""}`,
      searched: (n) => `searched ${String(n)} pattern${n > 1 ? "s" : ""}`,
      used: (n) => `used ${String(n)} tool${n > 1 ? "s" : ""}`,
    } as const;

    for (const [key, count] of Object.entries<number>(counts)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      parts.push(labels[key as Key](count));
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return parts.join(", ");
}

interface TurnSummaryBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function TurnSummaryBlock(props: TurnSummaryBlockProps) {
  const { message, expanded } = props;
  const { content: thinkingText, thinkingDuration, toolSummary = [] } = message;
  const summaryText = buildTurnSummaryText(thinkingDuration, toolSummary);

  if (!summaryText) {
    return null;
  }

  if (!expanded) {
    return (
      <Box marginBottom={0}>
        <Text dimColor>
          {"  "}
          {summaryText}
        </Text>
      </Box>
    );
  }

  // Expanded: full thinking + individual tool results
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text dimColor>{summaryText}</Text>
      {thinkingText ? (
        <Box marginBottom={0}>
          <Text dimColor>
            {COLORS.thinking(`${ICONS.thinking} `)}
            {thinkingText}
          </Text>
        </Box>
      ) : null}
      {toolSummary.map((t, i) => {
        const icon = t.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
        const timeStr = t.elapsed ? ` (${t.elapsed.toFixed(1)}s)` : "";
        return (
          <Box key={i} flexDirection="column" marginBottom={0}>
            <Text>
              {icon} {COLORS.tool(t.toolName)}
              {t.argsSummary ? <Text dimColor> {t.argsSummary}</Text> : null}
              <Text dimColor>{timeStr}</Text>
            </Text>
            {t.output ? (
              <Box paddingLeft={2}>
                <Text dimColor>
                  {t.output.length > 500 ? t.output.slice(0, 500) + "..." : t.output}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

interface MessageBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function MessageBlock(props: MessageBlockProps) {
  const { message, expanded } = props;

  switch (message.role) {
    case "user": {
      return (
        <Box marginBottom={0}>
          <Text>
            {COLORS.primary(`${ICONS.prompt} `)}
            {message.content}
          </Text>
        </Box>
      );
    }

    case "assistant": {
      return (
        <Box marginBottom={0}>
          <Text>{renderMarkdown(message.content)}</Text>
        </Box>
      );
    }

    case "thinking": {
      return (
        <Box marginBottom={0}>
          <Text dimColor>
            {COLORS.thinking(`${ICONS.thinking} `)}
            {message.content.length > 200 ? message.content.slice(0, 200) + "..." : message.content}
          </Text>
        </Box>
      );
    }

    case "tool_use": {
      return (
        <Box marginBottom={0}>
          <Text>
            <Text color="magenta">●</Text> {COLORS.tool(message.toolName ?? "tool")}
            {message.argsSummary ? <Text dimColor> {message.argsSummary}</Text> : null}
          </Text>
        </Box>
      );
    }
    case "tool_result": {
      const icon = message.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
      const timeStr = message.elapsed !== undefined ? ` (${message.elapsed.toFixed(1)}s)` : "";
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Text>
            {icon} {COLORS.tool(message.toolName ?? "tool")}
            {message.argsSummary ? <Text dimColor> {message.argsSummary}</Text> : null}
            <Text dimColor>{timeStr}</Text>
          </Text>
          {message.content && (
            <Box paddingLeft={2}>
              <Text dimColor>
                {!expanded && message.content.length > 500
                  ? message.content.slice(0, 500) + "…  (ctrl+o to expand)"
                  : message.content}
              </Text>
            </Box>
          )}
        </Box>
      );
    }

    case "turn_summary": {
      return <TurnSummaryBlock message={message} expanded={expanded} />;
    }

    case "system": {
      return (
        <Box marginBottom={0}>
          <Text dimColor>{message.content}</Text>
        </Box>
      );
    }
    default: {
      return null;
    }
  }
}
