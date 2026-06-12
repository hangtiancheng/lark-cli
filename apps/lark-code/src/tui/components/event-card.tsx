// EventCard: polymorphic renderer for different agent event types
import React from "react";
import { Box, Text } from "ink";

import { theme, truncate } from "../theme.js";
import { isRecord } from "../../core/bus/envelope.js";
import { ToolUseCard } from "./tool-use-card.js";

// Normalized event representation for rendering
export interface AgentEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
}

// Render a single event as a styled line or card
export function EventCard({
  event,
}: {
  readonly event: AgentEvent;
}): React.JSX.Element {
  const { type, data } = event;

  switch (type) {
    case "step.started": {
      const step = typeof data["step"] === "number" ? data["step"] : 0;
      return (
        <Box paddingX={1}>
          <Text color={theme.accentDim}>{"─".repeat(4)}</Text>
          <Text color={theme.accent} bold>
            step {String(step)}
          </Text>
          <Text color={theme.accentDim}> {"─".repeat(40)}</Text>
        </Box>
      );
    }

    case "step.finished": {
      const step = typeof data["step"] === "number" ? data["step"] : 0;
      return (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>{"─".repeat(4)}</Text>
          <Text color={theme.textDim}> step {String(step)} done</Text>
        </Box>
      );
    }

    case "tool.call_started": {
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
      const paramsRaw = data["params"];
      const params = isRecord(paramsRaw) ? paramsRaw : undefined;
      return (
        <ToolUseCard
          toolName={toolName}
          status="running"
          {...(params ? { params } : {})}
        />
      );
    }

    case "tool.call_finished": {
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
      const elapsedMs =
        typeof data["elapsed_ms"] === "number" ? data["elapsed_ms"] : 0;
      const output = typeof data["output"] === "string" ? data["output"] : "";
      return (
        <ToolUseCard
          toolName={toolName}
          status="success"
          elapsedMs={elapsedMs}
          output={output}
        />
      );
    }

    case "tool.call_failed": {
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
      const elapsedMs =
        typeof data["elapsed_ms"] === "number" ? data["elapsed_ms"] : 0;
      const errorMessage =
        typeof data["error_message"] === "string"
          ? data["error_message"]
          : "unknown error";
      return (
        <ToolUseCard
          toolName={toolName}
          status="failed"
          elapsedMs={elapsedMs}
          errorMessage={errorMessage}
        />
      );
    }

    case "llm.token": {
      const token = typeof data["token"] === "string" ? data["token"] : "";
      return (
        <Box paddingX={2}>
          <Text color={theme.text} wrap="wrap">
            {token}
          </Text>
        </Box>
      );
    }

    case "llm.text": {
      const text = typeof data["text"] === "string" ? data["text"] : "";
      return (
        <Box paddingX={2}>
          <Text color={theme.text} wrap="wrap">
            {text}
          </Text>
        </Box>
      );
    }

    case "llm.usage": {
      const inputTokens =
        typeof data["input_tokens"] === "number" ? data["input_tokens"] : 0;
      const outputTokens =
        typeof data["output_tokens"] === "number" ? data["output_tokens"] : 0;
      const contextPercent =
        typeof data["context_percent"] === "number"
          ? data["context_percent"]
          : 0;
      return (
        <Box paddingX={2}>
          <Text color={theme.textMuted}>tokens:</Text>
          <Text color={theme.info}> in={String(inputTokens)}</Text>
          <Text color={theme.info}> out={String(outputTokens)}</Text>
          <Text color={theme.textMuted}>
            {" "}
            ctx={String(Math.round(contextPercent * 100))}%
          </Text>
        </Box>
      );
    }

    case "run.started": {
      const goal = typeof data["goal"] === "string" ? data["goal"] : "";
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box>
            <Text color={theme.accentBright} bold>
              ▶ RUN STARTED
            </Text>
          </Box>
          <Box>
            <Text color={theme.text}> {truncate(goal, 70)}</Text>
          </Box>
        </Box>
      );
    }

    case "run.finished": {
      const status =
        typeof data["status"] === "string" ? data["status"] : "unknown";
      const steps = typeof data["steps"] === "number" ? data["steps"] : 0;
      const color = status === "success" ? theme.success : theme.error;
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box>
            <Text color={color} bold>
              ■ RUN {status.toUpperCase()}
            </Text>
            <Text color={theme.textDim}> ({String(steps)} steps)</Text>
          </Box>
        </Box>
      );
    }

    case "permission.requested": {
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
      const paramsPreview =
        typeof data["params_preview"] === "string"
          ? data["params_preview"]
          : "";
      return (
        <Box
          borderStyle="double"
          borderColor={theme.warning}
          paddingX={1}
          flexDirection="column"
          marginLeft={2}
        >
          <Box>
            <Text color={theme.warning} bold>
              PERMISSION REQUIRED
            </Text>
          </Box>
          <Box>
            <Text color={theme.text}> {toolName}</Text>
          </Box>
          {paramsPreview ? (
            <Box>
              <Text color={theme.textDim}> {truncate(paramsPreview, 60)}</Text>
            </Box>
          ) : null}
          <Box>
            <Text color={theme.textMuted}>
              [a]llow [d]eny [A]lways allow [D]lways deny
            </Text>
          </Box>
        </Box>
      );
    }

    case "session.created": {
      const sessionId =
        typeof data["session_id"] === "string" ? data["session_id"] : "";
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>● session {truncate(sessionId, 20)}</Text>
        </Box>
      );
    }

    case "log.line": {
      const level = typeof data["level"] === "string" ? data["level"] : "INFO";
      const message =
        typeof data["message"] === "string" ? data["message"] : "";
      const color =
        level === "ERROR"
          ? theme.error
          : level === "WARN"
            ? theme.warning
            : theme.textMuted;
      return (
        <Box paddingX={2}>
          <Text color={color}>{truncate(message, 80)}</Text>
        </Box>
      );
    }

    default:
      return (
        <Box paddingX={2}>
          <Text color={theme.textMuted}>
            {type}: {truncate(JSON.stringify(data), 60)}
          </Text>
        </Box>
      );
  }
}
