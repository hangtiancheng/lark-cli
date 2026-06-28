import { z } from "zod";
import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { renderMarkdownSync } from "../utils/markdown.js";
import { boolArg, isRecord } from "@/utils/index.js";

export interface ToolSummaryItem {
  toolName: string;
  argsSummary: string;
  output: string;
  isError: boolean;
  elapsed: number;
}

const ToolSummaryItemSchema = z.object({
  toolName: z.string(),
  argsSummary: z.string(),
  output: z.string(),
  isError: z.boolean(),
  elapsed: z.number(),
});

const ChatMessageSchema = z.object({
  role: z.enum([
    "user",
    "assistant",
    "system",
    "thinking",
    "tool_use",
    "tool_result",
    "turn_summary",
  ]),
  content: z.string(),
  toolName: z.string().optional(),
  argsSummary: z.string().optional(),
  isError: z.boolean().optional(),
  elapsed: z.number().optional(),
  thinkingDuration: z.number().optional(),
  toolSummary: z.array(ToolSummaryItemSchema).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

function buildTurnSummaryText(
  thinkingDuration: number | undefined,
  tools: ToolSummaryItem[],
): string {
  const parts: string[] = [];

  if (thinkingDuration !== undefined && thinkingDuration >= 1) {
    parts.push(`Thought for ${String(Math.round(thinkingDuration))}s`);
  }

  if (tools.length > 0) {
    const counts: Record<string, number> = {
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
        counts.read++;
      } else if (name === "WriteFile") {
        counts.wrote++;
      } else if (name === "EditFile") {
        counts.edited++;
      } else if (name === "Bash") {
        counts.ran++;
      } else if (name === "Glob") {
        counts.globbed++;
      } else if (name === "Grep") {
        counts.searched++;
      } else {
        counts.used++;
      }
    }

    const labels: Record<string, (n: number) => string> = {
      read: (n) => `read ${String(n)} file${n > 1 ? "s" : ""}`,
      wrote: (n) => `wrote ${String(n)} file${n > 1 ? "s" : ""}`,
      edited: (n) => `edited ${String(n)} file${n > 1 ? "s" : ""}`,
      ran: (n) => `ran ${String(n)} command${n > 1 ? "s" : ""}`,
      globbed: (n) => `globbed ${String(n)} pattern${n > 1 ? "s" : ""}`,
      searched: (n) => `searched ${String(n)} pattern${n > 1 ? "s" : ""}`,
      used: (n) => `used ${String(n)} tool${n > 1 ? "s" : ""}`,
    };

    for (const [key, count] of Object.entries(counts)) {
      if (count > 0) {
        parts.push(labels[key](count));
      }
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return parts.join(", ");
}

function renderTurnSummary(message: ChatMessage, expanded: boolean): VDomNode {
  const { content: thinkingText, thinkingDuration, toolSummary = [] } = message;
  const summaryText = buildTurnSummaryText(thinkingDuration, toolSummary);

  if (!summaryText) {
    return Box({ children: [] });
  }

  if (!expanded) {
    return Box({
      children: [Text({ dimColor: true, children: "  " + summaryText })],
    });
  }

  const children: VDomNode[] = [Text({ dimColor: true, children: summaryText })];

  if (thinkingText) {
    children.push(
      Box({
        children: [
          Text({
            dimColor: true,
            children: [COLORS.thinking(`${ICONS.thinking} `), thinkingText],
          }),
        ],
      }),
    );
  }

  for (const t of toolSummary) {
    const icon = t.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
    const timeStr = t.elapsed ? ` (${t.elapsed.toFixed(1)}s)` : "";
    const toolChildren: VDomNode[] = [
      Text({
        children: [
          icon + " " + COLORS.tool(t.toolName),
          ...(t.argsSummary ? [Text({ dimColor: true, children: " " + t.argsSummary })] : []),
          Text({ dimColor: true, children: timeStr }),
        ],
      }),
    ];
    if (t.output) {
      toolChildren.push(
        Box({
          paddingLeft: 2,
          children: [
            Text({
              dimColor: true,
              children: t.output.length > 500 ? t.output.slice(0, 500) + "..." : t.output,
            }),
          ],
        }),
      );
    }
    children.push(Box({ children: toolChildren }));
  }

  return Box({ children });
}

function renderMessageBlock(message: ChatMessage, expanded: boolean): VDomNode {
  switch (message.role) {
    case "user": {
      return Box({
        children: [
          Text({
            children: [COLORS.primary(`${ICONS.prompt} `), message.content],
          }),
        ],
      });
    }

    case "assistant": {
      const md = renderMarkdownSync(message.content);
      return Box({
        children: [Text({ children: md })],
      });
    }

    case "thinking": {
      return Box({
        children: [
          Text({
            dimColor: true,
            children: [
              COLORS.thinking(`${ICONS.thinking} `),
              message.content.length > 200
                ? message.content.slice(0, 200) + "..."
                : message.content,
            ],
          }),
        ],
      });
    }

    case "tool_use": {
      return Box({
        children: [
          Text({
            children: [
              Text({ color: "magenta", children: "●" }),
              ` ${COLORS.tool(message.toolName ?? "tool")}`,
              ...(message.argsSummary
                ? [Text({ dimColor: true, children: " " + message.argsSummary })]
                : []),
            ],
          }),
        ],
      });
    }

    case "tool_result": {
      const icon = message.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
      const timeStr = message.elapsed !== undefined ? ` (${message.elapsed.toFixed(1)}s)` : "";
      const children: VDomNode[] = [
        Text({
          children: [
            icon + " " + COLORS.tool(message.toolName ?? "tool"),
            ...(message.argsSummary
              ? [Text({ dimColor: true, children: " " + message.argsSummary })]
              : []),
            Text({ dimColor: true, children: timeStr }),
          ],
        }),
      ];

      if (message.content) {
        children.push(
          Box({
            paddingLeft: 2,
            children: [
              Text({
                dimColor: true,
                children:
                  !expanded && message.content.length > 500
                    ? message.content.slice(0, 500) + "…  (ctrl+o to expand)"
                    : message.content,
              }),
            ],
          }),
        );
      }

      return Box({ children });
    }

    case "turn_summary": {
      return renderTurnSummary(message, expanded);
    }

    case "system": {
      return Box({
        children: [Text({ dimColor: true, children: message.content })],
      });
    }

    default: {
      return Box({ children: [] });
    }
  }
}

export const ChatView = defineTerminalView((_ctx, _props?: Record<string, unknown>) => {
  return (data) => {
    const messagesRaw = data.messages;
    const messages: ChatMessage[] = Array.isArray(messagesRaw)
      ? messagesRaw.filter(
          (msg): msg is ChatMessage => isRecord(msg) && typeof msg.role === "string",
        )
      : [];
    const rawStreaming = data.streamingText;
    const streamingText = typeof rawStreaming === "string" ? rawStreaming : undefined;
    const expanded = boolArg(data, "expanded", false);

    const children: VDomNode[] = messages.map((msg) => renderMessageBlock(msg, expanded));

    if (streamingText) {
      children.push(
        Box({
          children: [
            Text({
              children: [COLORS.assistant(`${ICONS.dot} `), renderMarkdownSync(streamingText)],
            }),
          ],
        }),
      );
    }

    return Box({
      paddingLeft: 1,
      children,
    });
  };
});

/** CommittedMessage renders a single finalized message for static output */
export const CommittedMessageView = defineTerminalView((_ctx, _props?: Record<string, unknown>) => {
  return (data) => {
    const raw = data.message;
    if (!isRecord(raw)) {
      return Box({ children: [] });
    }
    // Validate with zod schema
    const parseResult = ChatMessageSchema.safeParse(raw);
    if (!parseResult.success) {
      return Box({ children: [] });
    }
    const message: ChatMessage = parseResult.data;
    const expanded = boolArg(data, "expanded", false);

    return Box({
      paddingLeft: 1,
      children: [renderMessageBlock(message, expanded)],
    });
  };
});
