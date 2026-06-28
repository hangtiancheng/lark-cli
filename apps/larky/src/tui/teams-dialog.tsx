import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS, ICONS } from "./styles.js";
import type { TeammateUIState } from "../teams/progress.js";
import { formatTokens } from "../teams/progress.js";

interface Props {
  teammates: TeammateUIState[];
  onClose: () => void;
  onKill?: (name: string, teamName: string) => void;
  onShutdown?: (name: string, teamName: string) => void;
}

type View = "list" | "detail";

export function TeamsDialog({ teammates, onClose, onKill, onShutdown }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>("list");
  const [detailName, setDetailName] = useState<string | null>(null);

  const clampedIndex = Math.min(selectedIndex, teammates.length - 1);

  useInput((input, key) => {
    if (view === "detail") {
      if (key.escape || key.leftArrow) {
        setView("list");
        setDetailName(null);
        return;
      }
      const mate = teammates.find((t) => t.name === detailName);
      if (!mate) {
        return;
      }
      if (input === "k" && onKill) {
        onKill(mate.name, mate.teamName);
      } else if (input === "s" && onShutdown) {
        onShutdown(mate.name, mate.teamName);
      }
      return;
    }

    // list view
    if (key.escape) {
      onClose();
    } else if (key.upArrow) {
      setSelectedIndex((c) => (c > 0 ? c - 1 : teammates.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((c) => (c < teammates.length - 1 ? c + 1 : 0));
    } else if (key.return && teammates.length > 0) {
      const mate = teammates[clampedIndex];
      setDetailName(mate.name);
      setView("detail");
    } else if (input === "k" && onKill && teammates.length > 0) {
      const mate = teammates[clampedIndex];
      onKill(mate.name, mate.teamName);
    } else if (input === "s" && onShutdown && teammates.length > 0) {
      const mate = teammates[clampedIndex];
      onShutdown(mate.name, mate.teamName);
    }
  });

  if (teammates.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
        <Text>{COLORS.primary("━━━ Teams ━━━━━━━━━━━━━━━━━━━━━━━━")}</Text>{" "}
        <Text dimColor> No active teammates</Text>{" "}
        <Text>{COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}</Text>
        <Text dimColor>Esc close</Text>
      </Box>
    );
  }

  if (view === "detail" && detailName) {
    const mate = teammates.find((t) => t.name === detailName);
    if (!mate) {
      setView("list");
      setDetailName(null);
      return null;
    }
    return renderDetail(mate);
  }

  return renderList(teammates, clampedIndex);
}

function formatElapsed(startTime: number): string {
  const secs = Math.floor((Date.now() - startTime) / 1000);
  if (secs < 60) {
    return `${String(secs)}s`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${String(mins)}m${String(secs % 60)}s`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h${String(mins % 60)}m`;
}

function statusColor(status: TeammateUIState["status"]): string {
  switch (status) {
    case "running":
      return "green";
    case "idle":
      return "yellow";
    case "completed":
      return "cyan";
    case "failed":
      return "red";
    case "stopped":
      return "gray";
  }
}

function renderList(teammates: TeammateUIState[], selectedIndex: number) {
  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text>{COLORS.primary("━━━ Teams ━━━━━━━━━━━━━━━━━━━━━━━━")}</Text>{" "}
      {teammates.map((mate, i) => {
        const isSelected = i === selectedIndex;
        const indicator = isSelected ? COLORS.tool(`${ICONS.prompt} `) : "  ";
        const tools = mate.progress.toolUseCount;
        const tokens = formatTokens(mate.progress.tokenCount);
        const toolLabel = tools === 1 ? "tool" : "tools";
        return (
          <Text key={mate.name}>
            {indicator}
            <Text color={isSelected ? "cyan" : ""} dimColor={!isSelected}>
              @{mate.name}
            </Text>
            <Text dimColor={!isSelected}>
              {" "}
              (<Text color={statusColor(mate.status)}>{mate.status}</Text>) {ICONS.dot} {tools}{" "}
              {toolLabel} {ICONS.dot} {tokens} tokens
            </Text>
          </Text>
        );
      })}{" "}
      <Text>{COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}</Text>
      <Text dimColor>{"  ↑/↓ select · Enter detail · k kill · s shutdown · Esc close"}</Text>
    </Box>
  );
}

function renderDetail(mate: TeammateUIState) {
  const elapsed = formatElapsed(mate.startTime);
  const tools = mate.progress.toolUseCount;
  const tokens = formatTokens(mate.progress.tokenCount);
  const toolLabel = tools === 1 ? "tool" : "tools";
  const activities = mate.progress.recentActivities;

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text>{COLORS.primary(`━━━ @${mate.name} ━━━━━━━━━━━━━━━━━━━━━━━`)}</Text>{" "}
      <Text>
        {"  Status: "}
        <Text color={statusColor(mate.status)}>{mate.status}</Text> {ICONS.dot} {elapsed}{" "}
        {ICONS.dot} {tools} {toolLabel} {ICONS.dot} {tokens} tokens
      </Text>{" "}
      {activities.length > 0 ? (
        <>
          <Text dimColor> Recent Activity:</Text>
          {activities.map((act, i) => {
            const isLast = i === activities.length - 1;
            const prefix = isLast ? `  ${ICONS.prompt} ` : "    ";
            return (
              <Text key={i}>
                {isLast ? COLORS.tool(prefix) : <Text dimColor>{prefix}</Text>}
                <Text color={isLast ? "cyan" : ""} dimColor={!isLast}>
                  {act.activityDescription}
                </Text>
              </Text>
            );
          })}
        </>
      ) : (
        <Text dimColor> No recent activity</Text>
      )}
      {mate.lastMessage && (
        <>
          {" "}
          <Text dimColor> Last message:</Text>
          <Text>
            {"  "}
            {mate.lastMessage.length > 80
              ? mate.lastMessage.slice(0, 80) + "..."
              : mate.lastMessage}
          </Text>
        </>
      )}{" "}
      <Text>{COLORS.primary("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}</Text>
      <Text dimColor>{"  ← back · k kill · s shutdown · Esc close"}</Text>
    </Box>
  );
}
