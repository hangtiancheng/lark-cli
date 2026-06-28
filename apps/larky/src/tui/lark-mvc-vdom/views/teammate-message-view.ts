import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { strArg } from "@/utils/index.js";

interface TeammateMessageProps {
  from: string;
  content: string;
  type?: "idle" | "completed" | "text" | "shutdown";
}

const TEAM_MSG_RE = /^\[team\s+\S+\]\s+(\S+):\s+(.*)$/s;
const IDLE_RE = /^\[idle\]\s*/;
const SHUTDOWN_RE = /^\[shutdown\]\s*/;

/** Parse a raw drainLeads string into structured teammate message fields */
export function parseTeammateMessage(raw: string): TeammateMessageProps | null {
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
    return { from, content: body.replace(SHUTDOWN_RE, ""), type: "shutdown" };
  }

  return { from, content: body, type: "text" };
}

function renderCompleted(from: string, content: string): VDomNode {
  const children: VDomNode[] = [
    Text({
      children: [
        Text({ color: "cyan", children: `@${from}` }),
        "> ",
        Text({ color: "green", children: "✓" }),
        " Task completed",
      ],
    }),
  ];

  if (content) {
    children.push(Text({ children: "  " + content }));
  }

  return Box({ children });
}

function renderText(from: string, content: string): VDomNode {
  const lines = content.split("\n");
  const summary = lines[0] ?? "";
  const rest = lines.slice(1).join("\n").trimStart();

  const children: VDomNode[] = [
    Text({
      children: [Text({ color: "cyan", children: `@${from}` }), "> ", summary],
    }),
  ];

  if (rest) {
    children.push(Text({ children: "  " + rest }));
  }

  return Box({ children });
}

export const TeammateMessageView = defineTerminalView((_ctx, _props?: Record<string, unknown>) => {
  return (data) => {
    const from = strArg(data, "from");
    const content = strArg(data, "content");
    const type = strArg(data, "type", "text");

    if (type === "idle" || type === "shutdown") {
      return Box({ children: [] });
    }

    if (type === "completed") {
      return renderCompleted(from, content);
    }

    return renderText(from, content);
  };
});
