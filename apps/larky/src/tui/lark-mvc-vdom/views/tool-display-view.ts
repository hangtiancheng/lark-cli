import type { VDomNode } from "@lark.js/mvc";
import { z } from "zod";
import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { strArg } from "../../../utils/index.js";

// Zod schema for ToolBlockInfo validation
const ToolBlockInfoSchema = z.object({
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  elapsed: z.number().optional(),
  loading: z.boolean().optional(),
});

type ToolBlockInfo = z.infer<typeof ToolBlockInfoSchema>;

function formatArgs(args: Record<string, unknown>): string {
  const command = strArg(args, "command");
  if (command) {
    return truncate(command, 80);
  }
  const filePath = strArg(args, "file_path");
  if (filePath) {
    return truncate(filePath, 80);
  }
  const pattern = strArg(args, "pattern");
  if (pattern) {
    return truncate(pattern, 80);
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function renderToolBlock(tool: ToolBlockInfo): VDomNode {
  const argSummary = formatArgs(tool.args);

  if (tool.loading) {
    return Box({
      children: [
        Text({
          children: [
            Text({ color: "magenta", children: "●" }),
            ` ${COLORS.tool(tool.toolName)}`,
            ...(argSummary ? [Text({ dimColor: true, children: argSummary })] : []),
          ],
        }),
      ],
    });
  }

  const icon = tool.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
  const timeStr = tool.elapsed !== undefined ? `(${tool.elapsed.toFixed(1)}s)` : "";

  const children: VDomNode[] = [
    Text({
      children: [
        icon + " " + COLORS.tool(tool.toolName),
        ...(argSummary ? [Text({ dimColor: true, children: " " + argSummary })] : []),
        Text({ dimColor: true, children: timeStr }),
      ],
    }),
  ];

  if (tool.output) {
    children.push(
      Box({
        paddingLeft: 2,
        children: [
          Text({
            dimColor: true,
            children: tool.output.length > 500 ? tool.output.slice(0, 500) + "…" : tool.output,
          }),
        ],
      }),
    );
  }

  return Box({ children });
}

export const ToolDisplayView = defineTerminalView((_ctx) => {
  return (data) => {
    const toolsRaw = data.tools;
    const toolsArray = Array.isArray(toolsRaw) ? toolsRaw : [];
    const tools = toolsArray
      .map((item) => ToolBlockInfoSchema.safeParse(item))
      .filter((result): result is z.ZodSafeParseSuccess<ToolBlockInfo> => result.success)
      .map((result) => result.data);

    if (tools.length === 0) {
      return Box({ children: [] });
    }

    return Box({
      paddingLeft: 1,
      children: tools.map((tool) => renderToolBlock(tool)),
    });
  };
});
