// EventCard: polymorphic renderer for different agent event types
// Claude Code style: inline indicators, no heavy borders, flowing text layout
// Supports: subagent tree, collapsible tools, permission resolution, markdown rendering
import React from "react";
import { Box, Text } from "ink";
import { marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

import { theme, truncate, formatTimestamp } from "../theme.js";
import { isRecord } from "../../core/bus/envelope.js";
import { ToolUseCard } from "./tool-use-card.js";

// Configure marked with terminal renderer (cached, created once)
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
marked.use(markedTerminal() as MarkedExtension);

// Normalized event representation for rendering
export interface AgentEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
}

// Props passed from EventLog to EventCard for stateful rendering
export interface EventCardContext {
  readonly expandedToolIds: ReadonlySet<string>;
  readonly onToggleTool: (toolUseId: string) => void;
  readonly subagentRunIds: ReadonlySet<string>;
  readonly permissionToolNames: ReadonlyMap<string, string>;
}

export interface EventCardProps {
  readonly event: AgentEvent;
  readonly context?: EventCardContext;
}

// Helper: extract string field from event data
function str(data: Record<string, unknown>, key: string): string {
  const val = data[key];
  return typeof val === "string" ? val : "";
}

// Helper: extract number field from event data
function num(data: Record<string, unknown>, key: string): number {
  const val = data[key];
  return typeof val === "number" ? val : 0;
}

// Render a single event as a compact styled line or inline card
export function EventCard({ event, context }: EventCardProps): React.JSX.Element {
  const { type, data } = event;
  const isSubagent = context
    ? typeof data["run_id"] === "string" && context.subagentRunIds.has(data["run_id"])
    : false;

  switch (type) {
    // Step separator — thin dashed line, compact
    case "step.started": {
      if (isSubagent) return <></>;
      const step = num(data, "step");
      return (
        <Box paddingX={1} marginTop={0}>
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
      if (isSubagent) return <></>;
      const step = num(data, "step");
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
      const toolName = str(data, "tool_name");
      const toolUseId = str(data, "tool_use_id");
      const paramsRaw = data["params"];
      const params = isRecord(paramsRaw) ? paramsRaw : undefined;
      const expanded = context?.expandedToolIds.has(toolUseId) ?? false;
      const onToggle = context?.onToggleTool;
      return (
        <ToolUseCard
          toolName={toolName}
          status="running"
          {...(params ? { params } : {})}
          {...(context ? { expanded } : {})}
          {...(onToggle
            ? {
                onToggle: () => {
                  onToggle(toolUseId);
                },
              }
            : {})}
          isSubagent={isSubagent}
        />
      );
    }

    case "tool.call_finished": {
      const toolName = str(data, "tool_name");
      const toolUseId = str(data, "tool_use_id");
      const elapsedMs = num(data, "elapsed_ms");
      const output = str(data, "output");
      const expanded = context?.expandedToolIds.has(toolUseId) ?? false;
      const onToggle = context?.onToggleTool;
      return (
        <ToolUseCard
          toolName={toolName}
          status="success"
          elapsedMs={elapsedMs}
          output={output}
          {...(context ? { expanded } : {})}
          {...(onToggle
            ? {
                onToggle: () => {
                  onToggle(toolUseId);
                },
              }
            : {})}
          isSubagent={isSubagent}
        />
      );
    }

    case "tool.call_failed": {
      const toolName = str(data, "tool_name");
      const toolUseId = str(data, "tool_use_id");
      const elapsedMs = num(data, "elapsed_ms");
      const errorMessage = str(data, "error_message");
      const expanded = context?.expandedToolIds.has(toolUseId) ?? false;
      const onToggle = context?.onToggleTool;
      return (
        <ToolUseCard
          toolName={toolName}
          status="failed"
          elapsedMs={elapsedMs}
          errorMessage={errorMessage}
          {...(context ? { expanded } : {})}
          {...(onToggle
            ? {
                onToggle: () => {
                  onToggle(toolUseId);
                },
              }
            : {})}
          isSubagent={isSubagent}
        />
      );
    }

    // LLM streaming output — flowing text with markdown rendering
    case "llm.token": {
      const token = str(data, "token");
      return (
        <Text color={theme.text} wrap="wrap">
          {token}
        </Text>
      );
    }

    case "llm.text": {
      const text = str(data, "text");
      const parsed = marked.parse(text);
      const rendered = typeof parsed === "string" ? parsed : "";
      return (
        <Box paddingX={1} marginTop={0}>
          <Text wrap="wrap">{rendered}</Text>
        </Box>
      );
    }

    // Model selected — show which model is being used
    case "llm.model_selected": {
      const model = str(data, "model");
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>{theme.indicator.arrow} model: </Text>
          <Text color={theme.textDim}>{model}</Text>
        </Box>
      );
    }

    // Usage summary — compact inline, no borders
    case "llm.usage": {
      if (isSubagent) return <></>;
      const inputTokens = num(data, "input_tokens");
      const outputTokens = num(data, "output_tokens");
      const contextPercent = num(data, "context_percent");
      return (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>
            tok in:{String(inputTokens)} out:{String(outputTokens)}
          </Text>
          <Text color={theme.textMuted}> ctx:{String(Math.round(contextPercent * 100))}%</Text>
        </Box>
      );
    }

    // Run lifecycle — compact inline indicators with visual grouping
    case "run.started": {
      const goal = str(data, "goal");
      const runId = str(data, "run_id");
      return (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Box>
            <Text color={theme.accentBright}>{theme.indicator.runStart} run</Text>
            <Text color={theme.textMuted}> {truncate(runId, 16)}</Text>
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
      const status = str(data, "status");
      const steps = num(data, "steps");
      const reason = str(data, "reason");
      const color = status === "success" ? theme.success : theme.error;
      const icon = status === "success" ? theme.indicator.toolSuccess : theme.indicator.toolFailed;
      return (
        <Box paddingX={1} marginBottom={1}>
          <Text color={color}>
            {icon} {status}
          </Text>
          <Text color={theme.textDim}> ({String(steps)} steps)</Text>
          {reason ? <Text color={theme.textMuted}> {reason}</Text> : null}
        </Box>
      );
    }

    // Permission request — inline warning indicator
    case "permission.requested": {
      const toolName = str(data, "tool_name");
      const paramsPreview = str(data, "params_preview");
      return (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Box>
            <Text color={theme.warning} bold>
              {theme.indicator.permission} permission
            </Text>
            <Text color={theme.toolName}> {toolName}</Text>
          </Box>
          {paramsPreview ? (
            <Box marginLeft={3}>
              <Text color={theme.textDim}>{truncate(paramsPreview, 60)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }

    // Permission granted — inline success indicator
    case "permission.granted": {
      const toolUseId = str(data, "tool_use_id");
      const decision = str(data, "decision");
      const toolName = context?.permissionToolNames.get(toolUseId) ?? "";
      const label =
        decision === "always_allow"
          ? "always allowed"
          : decision === "allow_once"
            ? "allowed"
            : decision;
      return (
        <Box paddingX={1}>
          <Text color={theme.success}>{theme.indicator.toolSuccess} permission</Text>
          {toolName ? <Text color={theme.toolName}> {toolName}</Text> : null}
          <Text color={theme.textDim}> {label}</Text>
        </Box>
      );
    }

    // Permission denied — inline failure indicator
    case "permission.denied": {
      const toolUseId = str(data, "tool_use_id");
      const decision = str(data, "decision");
      const toolName = context?.permissionToolNames.get(toolUseId) ?? "";
      const label =
        decision === "always_deny"
          ? "always denied"
          : decision === "deny_once"
            ? "denied"
            : decision;
      return (
        <Box paddingX={1}>
          <Text color={theme.error}>{theme.indicator.toolFailed} permission</Text>
          {toolName ? <Text color={theme.toolName}> {toolName}</Text> : null}
          <Text color={theme.textDim}> {label}</Text>
        </Box>
      );
    }

    // Session events — compact dot indicator
    case "session.created": {
      const sessionId = str(data, "session_id");
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
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.textDim}>{theme.indicator.bullet} ready for input</Text>
        </Box>
      );
    }

    case "session.resumed": {
      return (
        <Box paddingX={1}>
          <Text color={theme.info}>{theme.indicator.session} session resumed</Text>
        </Box>
      );
    }

    case "session.message_received": {
      const content = str(data, "content");
      return (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.accentBright} bold>
            {">"}{" "}
          </Text>
          <Text color={theme.text}>{truncate(content, 80)}</Text>
        </Box>
      );
    }

    case "session.closed": {
      return (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>{theme.indicator.runEnd} session closed</Text>
        </Box>
      );
    }

    // Log lines — compact, color-coded by level with timestamp
    case "log.line": {
      const level = str(data, "level") || "INFO";
      const message = str(data, "message");
      const color =
        level === "ERROR"
          ? theme.error
          : level === "WARNING" || level === "WARN"
            ? theme.warning
            : theme.textMuted;
      const ts = formatTimestamp(event.timestamp);
      return (
        <Box paddingX={1}>
          {ts ? <Text color={theme.textMuted}> {ts} </Text> : null}
          <Text color={color}>[{level}]</Text>
          <Text color={theme.textDim}> {truncate(message, 80)}</Text>
        </Box>
      );
    }

    // Subagent events — tree visualization with nesting
    case "subagent.started": {
      const description = str(data, "description") || "subagent task";
      const runId = str(data, "run_id");
      const shortId = runId.slice(0, 8);
      return (
        <Box marginLeft={2} marginTop={0}>
          <Text color={theme.subagentDim}>{theme.indicator.dash}</Text>
          <Text color={theme.subagentAccent}>
            {theme.indicator.step} {truncate(description, 72)}
          </Text>
          <Text color={theme.textMuted}> {shortId}</Text>
        </Box>
      );
    }

    case "subagent.finished": {
      const runId = str(data, "run_id");
      const status = str(data, "status");
      const shortId = runId.slice(0, 8);
      const isSuccess = status === "success";
      const icon = isSuccess ? theme.indicator.toolSuccess : theme.indicator.toolFailed;
      const color = isSuccess ? theme.success : theme.error;
      return (
        <Box marginLeft={2} marginBottom={0}>
          <Text color={theme.subagentDim}>{theme.indicator.dash}</Text>
          <Text color={color}>
            {theme.indicator.step} {icon}
          </Text>
          <Text color={theme.subagentAccent}> done</Text>
          <Text color={theme.textMuted}> {shortId}</Text>
        </Box>
      );
    }

    // Skill invocation — inline indicator
    case "skill.invoked": {
      const skillName = str(data, "skill_name");
      const args = str(data, "arguments");
      return (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.info}>{theme.indicator.arrow} skill: </Text>
          <Text color={theme.toolName} bold>
            /{skillName}
          </Text>
          {args ? <Text color={theme.textDim}> {truncate(args, 40)}</Text> : null}
        </Box>
      );
    }

    // Compaction events — compact indicator
    case "context.compacted": {
      const originalTokens = num(data, "original_tokens");
      const summaryTokens = num(data, "summary_tokens");
      const savedTokens = Math.max(0, originalTokens - summaryTokens);
      return (
        <Box paddingX={1} marginTop={0}>
          <Text color={theme.info}>{theme.indicator.compact} compacted</Text>
          <Text color={theme.textDim}>
            {" "}
            (saved {String(savedTokens)} tokens: {String(originalTokens)} → {String(summaryTokens)})
          </Text>
        </Box>
      );
    }

    // Core started — daemon ready
    case "core.started": {
      const version = str(data, "version");
      return (
        <Box paddingX={1}>
          <Text color={theme.success}>{theme.indicator.session} core ready</Text>
          {version ? <Text color={theme.textMuted}> v{version}</Text> : null}
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
