import { Box, Text } from "ink";
import { useCallback, useImperativeHandle, type Ref } from "react";

type PropsWithRef<T, R> = T & { ref: Ref<R> };

interface TeammateMessageProps {
  from: string;
  content: string;
  type?: "idle" | "completed" | "text" | "shutdown";
}

interface TeammateMessageExpose {
  parseTeammateMessage: (raw: string) => TeammateMessageProps | null;
}

// Regex for "[team xxx] sender: message" format produced by drainLeads.
const TEAM_MSG_RE = /^\[team\s+\S+\]\s+(\S+):\s+(.*)$/s;

// Prefixes that indicate special message types.
const IDLE_RE = /^\[idle\]\s*/;
const SHUTDOWN_RE = /^\[shutdown\]\s*/;

/**
 * Renders a teammate message in the chat view.
 *
 * - idle / shutdown: silent (return null)
 * - completed: green checkmark + content
 * - text (default): cyan @name with content summary
 */
export function TeammateMessage(props: PropsWithRef<TeammateMessageProps, TeammateMessageExpose>) {
  const { from, content, type = "text", ref } = props;

  /**
   * Parses a raw drainLeads string into structured teammate message fields.
   *
   * Recognized formats:
   *   "[team alpha] alice: [idle] alice has completed..."  -> { from: "alice", type: "idle", ... }
   *   "[team alpha] bob: [shutdown] ..."                   -> { from: "bob",   type: "shutdown", ... }
   *   "[team alpha] carol: here is my update"              -> { from: "carol", type: "text", ... }
   *
   * Returns null when the string is not a teammate message.
   */
  const parseTeammateMessage = useCallback((raw: string): TeammateMessageProps | null => {
    const m = TEAM_MSG_RE.exec(raw);
    if (!m) {
      return null;
    }

    const from = m[1];
    const body = m[2];

    if (IDLE_RE.test(body)) {
      return { from, content: body.replace(IDLE_RE, ""), type: "idle" };
    }
    if (SHUTDOWN_RE.test(body)) {
      return {
        from,
        content: body.replace(SHUTDOWN_RE, ""),
        type: "shutdown",
      };
    }

    return { from, content: body, type: "text" };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      parseTeammateMessage,
    }),
    [parseTeammateMessage],
  );

  if (type === "idle" || type === "shutdown") {
    return null;
  }

  if (type === "completed") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">@{from}</Text>
          <Text>{">"} </Text>
          <Text color="green">✓</Text>
          <Text> Task completed</Text>
        </Text>
        {content ? (
          <Text>
            {"  "}
            {content}
          </Text>
        ) : null}
      </Box>
    );
  }

  // type === "text" (default)
  const lines = content.split("\n");
  const summary = lines[0] ?? "";
  const rest = lines.slice(1).join("\n").trimStart();

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">@{from}</Text>
        <Text>{">"} </Text>
        <Text>{summary}</Text>
      </Text>
      {rest ? (
        <Text>
          {"  "}
          {rest}
        </Text>
      ) : null}
    </Box>
  );
}
