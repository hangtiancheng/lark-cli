// EventLog: scrollable event stream showing agent activity in real-time
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";

import { theme } from "../theme.js";
import { EventCard, type AgentEvent } from "./event-card.js";

export interface EventLogProps {
  readonly events: readonly AgentEvent[];
  readonly height: number;
}

// Merge consecutive llm.token events into a single llm.text event
// so the streaming output renders as flowing text rather than one-line-per-token
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
      const tok =
        typeof event.data["token"] === "string" ? event.data["token"] : "";
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

// Scrollable event log with keyboard navigation (j/k or arrow keys)
export function EventLog({ events, height }: EventLogProps): React.JSX.Element {
  const displayEvents = useMemo(() => mergeTokens(events), [events]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxScroll = Math.max(0, displayEvents.length - height);
  const scrollRef = useRef(maxScroll);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    scrollRef.current = Math.max(0, displayEvents.length - height);
    setScrollOffset(scrollRef.current);
  }, [displayEvents.length, height]);

  useInput((input, key) => {
    if (input === "j" || key.downArrow) {
      const next = Math.min(scrollOffset + 1, maxScroll);
      setScrollOffset(next);
    } else if (input === "k" || key.upArrow) {
      const prev = Math.max(scrollOffset - 1, 0);
      setScrollOffset(prev);
    } else if (input === "G") {
      setScrollOffset(maxScroll);
    } else if (input === "g") {
      setScrollOffset(0);
    }
  });

  const visibleEvents = displayEvents.slice(
    scrollOffset,
    scrollOffset + height,
  );
  const isAtBottom = scrollOffset >= maxScroll;
  const isAtTop = scrollOffset === 0;

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingX={1}>
        <Text color={theme.textMuted}>EVENTS</Text>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text color={theme.textMuted}>
            {isAtTop ? "▲ top" : ""}
            {isAtBottom ? "" : " "}
            {isAtBottom ? "▼ bottom" : ""}
          </Text>
          <Text color={theme.textMuted}>
            {" "}
            {String(scrollOffset + 1)}/{String(displayEvents.length)}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column" height={height} overflow="hidden">
        {visibleEvents.map((event, idx) => (
          <EventCard key={`${event.timestamp}-${String(idx)}`} event={event} />
        ))}
      </Box>
    </Box>
  );
}
