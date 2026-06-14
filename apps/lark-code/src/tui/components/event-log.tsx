// EventLog: scrollable event stream — Claude Code style
// No fixed height that causes occlusion; auto-grows and uses overflowY for scrolling
// Keyboard navigation: j/k/arrows for scroll, G/g for jump
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";

import { theme } from "../theme.js";
import { EventCard, type AgentEvent } from "./event-card.js";

export interface EventLogProps {
  readonly events: readonly AgentEvent[];
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

export function EventLog({ events }: EventLogProps): React.JSX.Element {
  const displayEvents = useMemo(() => mergeTokens(events), [events]);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Calculate visible line count from terminal height minus header+status+input (~5 lines)
  // This avoids the previous fixed height=30 that caused visual occlusion on small terminals
  const availableHeight = process.stdout.rows ? process.stdout.rows - 5 : 40;
  const maxScroll = Math.max(0, displayEvents.length - availableHeight);
  const scrollRef = useRef(maxScroll);

  // Auto-scroll to bottom when new events arrive (only when already near bottom)
  useEffect(() => {
    const newMax = Math.max(0, displayEvents.length - availableHeight);
    // If user was already at bottom, keep auto-scrolling
    setScrollOffset((prev) => {
      if (prev >= scrollRef.current - 3) {
        return newMax;
      }
      return prev;
    });
    scrollRef.current = newMax;
  }, [displayEvents.length, availableHeight]);

  useInput((input, key) => {
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

  const visibleEvents = displayEvents.slice(
    scrollOffset,
    scrollOffset + availableHeight,
  );
  const isAtBottom = scrollOffset >= maxScroll;

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
          <EventCard key={`${event.timestamp}-${String(idx)}`} event={event} />
        ))}
      </Box>
    </Box>
  );
}
