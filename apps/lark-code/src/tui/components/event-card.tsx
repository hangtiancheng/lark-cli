// EventCard: polymorphic renderer for different agent event types
// Claude Code style: inline indicators, no heavy borders, flowing text layout
import React from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

import { theme, truncate } from "../theme.js";
import { isRecord } from "../../core/bus/envelope.js";
import { ToolUseCard } from "./tool-use-card.js";

// Configure marked with terminal renderer (cached, created once)
marked.use(markedTerminal());

// Normalized event representation for rendering
export interface AgentEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
}

// Render a single event as a compact styled line or inline card
export function EventCard({
  event,
}: {
  readonly event: AgentEvent;
}): React.JSX.Element {
  const { type, data } = event;

  switch (type) {
    // Step separator — thin dashed line, compact
    case "step.started": {
      const step = typeof data["step"] === "number" ? data["step"] : 0;
      return (
        <Box paddingX={1}>
          <Text color={theme.accentDim}>
            {theme.indicator.step}
            {theme.indicator.step}
            {theme.indicator.step}
          </Text>
          <Text color={theme.accent}> step {String(step)}</Text>
          <Text color={theme.accentDim}>
            {" "}
            {theme.indicator.thinDash}
            {theme.indicator.thinDash}
            {theme.indicator.thinDash}
          </Text>
        </Box>
      );
    }

    case "step.finished": {
      const step = typeof data["step"] === "number" ? data["step"] : 0;
      return (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>
            {theme.indicator.step}
            {theme.indicator.step} step {String(step)} done
          </Text>
        </Box>
      );
    }

    // Tool calls — delegate to inline ToolUseCard (no borders)
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

    // LLM streaming output — flowing text with markdown rendering
    case "llm.token": {
      const token = typeof data["token"] === "string" ? data["token"] : "";
      return (
        <Text color={theme.text} wrap="wrap">
          {token}
        </Text>
      );
    }

    case "llm.text": {
      const text = typeof data["text"] === "string" ? data["text"] : "";
      const rendered = marked.parse(text) as string;
      return (
        <Box paddingX={1}>
          <Text wrap="wrap">{rendered}</Text>
        </Box>
      );
    }

    // Usage summary — compact inline, no borders
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
        <Box paddingX={1}>
          <Text color={theme.textMuted}>
            tok in:{String(inputTokens)} out:{String(outputTokens)}
          </Text>
          <Text color={theme.textMuted}>
            {" "}
            ctx:{String(Math.round(contextPercent * 100))}%
          </Text>
        </Box>
      );
    }

    // Run lifecycle — compact inline indicators
    case "run.started": {
      const goal = typeof data["goal"] === "string" ? data["goal"] : "";
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box>
            <Text color={theme.accentBright}>
              {theme.indicator.runStart} run
            </Text>
          </Box>
          {goal ? (
            <Box marginLeft={2}>
              <Text color={theme.text}>{truncate(goal, 80)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }

    case "run.finished": {
      const status =
        typeof data["status"] === "string" ? data["status"] : "unknown";
      const steps = typeof data["steps"] === "number" ? data["steps"] : 0;
      const color = status === "success" ? theme.success : theme.error;
      return (
        <Box paddingX={1}>
          <Text color={color}>
            {theme.indicator.runEnd} {status}
          </Text>
          <Text color={theme.textDim}> ({String(steps)} steps)</Text>
        </Box>
      );
    }

    // Permission request — inline warning indicator, no double border box
    case "permission.requested": {
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
      const paramsPreview =
        typeof data["params_preview"] === "string"
          ? data["params_preview"]
          : "";
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Box>
            <Text color={theme.warning}>
              {theme.indicator.permission} permission:{" "}
            </Text>
            <Text color={theme.toolName}>{toolName}</Text>
          </Box>
          {paramsPreview ? (
            <Box marginLeft={3}>
              <Text color={theme.textDim}>{truncate(paramsPreview, 60)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }

    // Session events — compact dot indicator
    case "session.created": {
      const sessionId =
        typeof data["session_id"] === "string" ? data["session_id"] : "";
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>
            {theme.indicator.session} session {truncate(sessionId, 20)}
          </Text>
        </Box>
      );
    }

    case "session.waiting_for_input": {
      return (
        <Box paddingX={1}>
          <Text color={theme.textDim}>
            {theme.indicator.bullet} ready for input
          </Text>
        </Box>
      );
    }

    // Log lines — compact, color-coded by level
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
        <Box paddingX={1}>
          <Text color={color}>{truncate(message, 80)}</Text>
        </Box>
      );
    }

    // Subagent events — nested rendering with distinct accent color
    case "subagent.started": {
      const description =
        typeof data["description"] === "string"
          ? data["description"]
          : "subagent task";
      const runId = typeof data["run_id"] === "string" ? data["run_id"] : "";
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Box>
            <Text color={theme.subagentAccent}>
              {theme.indicator.subagent} {description}
            </Text>
          </Box>
          {runId ? (
            <Box marginLeft={3}>
              <Text color={theme.textMuted}>{truncate(runId, 16)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }

    case "subagent.finished": {
      const runId = typeof data["run_id"] === "string" ? data["run_id"] : "";
      const status =
        typeof data["status"] === "string" ? data["status"] : "unknown";
      const color = status === "success" ? theme.subagentAccent : theme.error;
      return (
        <Box marginLeft={2}>
          <Text color={color}>
            {theme.indicator.subagent} {status}
          </Text>
          {runId ? (
            <Text color={theme.textDim}> ({truncate(runId, 16)})</Text>
          ) : null}
        </Box>
      );
    }

    // Skill invocation — inline indicator
    case "skill.invoked": {
      const skillName =
        typeof data["skill_name"] === "string" ? data["skill_name"] : "unknown";
      const args =
        typeof data["arguments"] === "string" ? data["arguments"] : "";
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>{theme.indicator.arrow} skill: </Text>
          <Text color={theme.toolName}>{skillName}</Text>
          {args ? (
            <Text color={theme.textDim}> {truncate(args, 40)}</Text>
          ) : null}
        </Box>
      );
    }

    // Compaction events — compact indicator
    case "context.compacted": {
      const originalTokens =
        typeof data["original_tokens"] === "number"
          ? data["original_tokens"]
          : 0;
      const summaryTokens =
        typeof data["summary_tokens"] === "number" ? data["summary_tokens"] : 0;
      const savedTokens = Math.max(0, originalTokens - summaryTokens);
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>
            {theme.indicator.compact} compacted (saved {String(savedTokens)}{" "}
            tokens)
          </Text>
        </Box>
      );
    }

    default:
      return (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>
            {type}: {truncate(JSON.stringify(data), 60)}
          </Text>
        </Box>
      );
  }
}
