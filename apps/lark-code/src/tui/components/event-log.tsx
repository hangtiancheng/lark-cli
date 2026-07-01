// EventLog: scrollable event stream — Claude Code style
// No fixed height that causes occlusion; auto-grows and uses overflowY for scrolling
// Keyboard navigation: j/k/arrows for scroll, G/g for jump, Tab to toggle tool expansion
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

import { theme } from "../theme.js";
import { EventCard, type AgentEvent, type EventCardContext } from "./event-card.js";

export interface EventLogProps {
  readonly events: readonly AgentEvent[];
  readonly subagentRunIds?: ReadonlySet<string>;
  readonly permissionToolNames?: ReadonlyMap<string, string>;
  readonly showBanner?: boolean;
}

// Merge consecutive llm.token events into a single llm.text event
// so streaming output renders as flowing text rather than one-line-per-token
function mergeTokens(events: readonly AgentEvent[]): AgentEvent[] {
  const merged: AgentEvent[] = [];
  let tokenBuf: string[] = [];
  let tokenTs = "";

  const flush = (): void => {
    if (tokenBuf.length > 0) {
      merged.push({
        type: "llm.text",
        data: { text: tokenBuf.join("") },
        timestamp: tokenTs,
      });
      tokenBuf = [];
      tokenTs = "";
    }
  };

  for (const event of events) {
    if (event.type === "llm.token") {
      const tok = typeof event.data["token"] === "string" ? event.data["token"] : "";
      tokenBuf.push(tok);
      if (!tokenTs) tokenTs = event.timestamp;
    } else {
      flush();
      merged.push(event);
    }
  }
  flush();
  return merged;
}

export function EventLog({
  events,
  subagentRunIds,
  permissionToolNames,
  showBanner,
}: EventLogProps): React.JSX.Element {
  const displayEvents = useMemo(() => mergeTokens(events), [events]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedToolIds, setExpandedToolIds] = useState<ReadonlySet<string>>(new Set());
  const availableHeight = process.stdout.rows ? process.stdout.rows - 5 : 40;
  const maxScroll = Math.max(0, displayEvents.length - availableHeight);
  const scrollRef = useRef(maxScroll);

  // Auto-scroll to bottom when new events arrive (only when already near bottom)
  useEffect(() => {
    const newMax = Math.max(0, displayEvents.length - availableHeight);
    setScrollOffset((prev) => {
      if (prev >= scrollRef.current - 3) {
        return newMax;
      }
      return prev;
    });
    scrollRef.current = newMax;
  }, [displayEvents.length, availableHeight]);

  // Toggle expansion of a tool block
  const handleToggleTool = useCallback((toolUseId: string) => {
    setExpandedToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(toolUseId)) {
        next.delete(toolUseId);
      } else {
        next.add(toolUseId);
      }
      return next;
    });
  }, []);

  // Build EventCardContext for stateful rendering
  const cardContext: EventCardContext = {
    expandedToolIds,
    onToggleTool: handleToggleTool,
    subagentRunIds: subagentRunIds ?? new Set(),
    permissionToolNames: permissionToolNames ?? new Map(),
  };

  // Tab: toggle expansion of the most recent tool block in the visible window
  useInput((input, key) => {
    if (key.tab && !key.shift) {
      const visibleStart = scrollOffset;
      const visibleEnd = Math.min(scrollOffset + availableHeight, displayEvents.length);
      let lastToolIdx = -1;
      for (let i = visibleEnd - 1; i >= visibleStart; i--) {
        const ev = displayEvents[i];
        if (ev.type === "tool.call_finished" || ev.type === "tool.call_failed") {
          lastToolIdx = i;
          break;
        }
      }
      if (lastToolIdx >= 0) {
        const toolEvent = displayEvents[lastToolIdx];
        const toolUseId =
          typeof toolEvent.data["tool_use_id"] === "string" ? toolEvent.data["tool_use_id"] : "";
        if (toolUseId) {
          handleToggleTool(toolUseId);
        }
      }
      return;
    }

    if (input === "j" || key.downArrow) {
      setScrollOffset(Math.min(scrollOffset + 3, maxScroll));
    } else if (input === "k" || key.upArrow) {
      setScrollOffset(Math.max(scrollOffset - 3, 0));
    } else if (input === "G") {
      setScrollOffset(maxScroll);
    } else if (input === "g") {
      setScrollOffset(0);
    }
  });

  const visibleEvents = displayEvents.slice(scrollOffset, scrollOffset + availableHeight);
  const isAtBottom = scrollOffset >= maxScroll;

  // Show banner when no events and banner requested
  if (showBanner && displayEvents.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} width="100%" justifyContent="center">
        <Box flexDirection="column" paddingX={2}>
          <Text color={theme.textMuted}> </Text>
          <Text color={theme.textDim}>
            {"  Enter a message to start chatting  ·  Type / to trigger a skill  ·  Ctrl+C to exit"}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} width="100%">
      {/* Scroll position indicator — compact, no "EVENTS" label */}
      {displayEvents.length > availableHeight ? (
        <Box paddingX={1}>
          <Text color={theme.textMuted}>
            {String(scrollOffset + 1)}/{String(displayEvents.length)}
            {isAtBottom ? "" : " ↓"}
          </Text>
        </Box>
      ) : null}

      {/* Event stream — no border, no fixed height overflow clipping */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {visibleEvents.map((event, idx) => (
          <EventCard
            key={`${event.timestamp}-${String(idx)}`}
            event={event}
            context={cardContext}
          />
        ))}
      </Box>
    </Box>
  );
}
