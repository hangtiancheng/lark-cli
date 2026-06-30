import { Box, Text } from "ink";
import { COLORS, ICONS } from "./styles.js";
import { strArg } from "@/utils/index.js";

export interface ToolBlockInfo {
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  elapsed?: number;
  loading?: boolean;
}

interface ToolBlockProps {
  tool: ToolBlockInfo;
}

interface ToolDisplayProps {
  tools: ToolBlockInfo[];
}

function ToolBlock(props: ToolBlockProps) {
  const { tool } = props;
  const argSummary = formatArgs(tool.args);
  if (tool.loading) {
    return (
      <Box>
        <Text>
          <Text color="magenta">●</Text> {COLORS.tool(tool.toolName)}
          {argSummary ? <Text dimColor>{argSummary}</Text> : null}
        </Text>
      </Box>
    );
  }

  const icon = tool.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
  const timeStr = tool.elapsed !== undefined ? `(${tool.elapsed.toFixed(1)}s)` : "";

  return (
    <Box flexDirection="column">
      <Text>
        {icon} {COLORS.tool(tool.toolName)}
        {argSummary ? <Text dimColor> {argSummary}</Text> : null}
        <Text dimColor>{timeStr}</Text>
      </Text>
      {tool.output && (
        <Box paddingLeft={2} marginBottom={0}>
          <Text dimColor>
            {tool.output.length > 500 ? tool.output.slice(0, 500) + "…" : tool.output}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function ToolDisplay(props: ToolDisplayProps) {
  const { tools } = props;
  if (tools.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {tools.map((tool, idx) => (
        <ToolBlock key={idx} tool={tool} />
      ))}
    </Box>
  );
}

// export default ToolDisplay;

function formatArgs(args: Record<string, unknown>): string {
  if (args.command) {
    return truncate(strArg(args, "command"), 80);
  }
  if (args.file_path) {
    return truncate(strArg(args, "file_path"), 80);
  }
  if (args.pattern) {
    return truncate(strArg(args, "pattern"), 80);
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
