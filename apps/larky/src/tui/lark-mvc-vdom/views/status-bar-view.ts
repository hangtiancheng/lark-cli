import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { ICONS } from "../utils/styles.js";
import { strArg, intArg } from "@/utils/index.js";

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

export const StatusBarView = defineTerminalView((_ctx, props?: Record<string, unknown>) => {
  const mode = strArg(props ?? {}, "mode", "");
  const inputTokens = intArg(props ?? {}, "inputTokens", 0);
  const outputTokens = intArg(props ?? {}, "outputTokens", 0);

  const parts: string[] = [];
  if (mode) {
    parts.push(mode);
  }
  if (inputTokens > 0) {
    parts.push(`${formatTokens(inputTokens)}↓ ${formatTokens(outputTokens)}↑`);
  }

  return () => {
    if (parts.length === 0) {
      return Box({ children: [] });
    }

    return Box({
      paddingLeft: 1,
      children: [
        Text({
          dimColor: true,
          children: parts.map((p, i) => (i > 0 ? ` ${ICONS.dot} ` : `${ICONS.dot} `) + p).join(""),
        }),
      ],
    });
  };
});
