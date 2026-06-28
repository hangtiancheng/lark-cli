import { defineTerminalView } from "../runtime/view-ctx.js";
import { tuiUseState, tuiUseEffect } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { getDotsFrame } from "../runtime/spinner-frames.js";
import { randomVerb } from "../utils/verbs.js";
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

export const SpinnerView = defineTerminalView((ctx, props?: Record<string, unknown>) => {
  const label = strArg(props ?? {}, "label", "");
  const inputTokens = intArg(props ?? {}, "inputTokens", 0);
  const outputTokens = intArg(props ?? {}, "outputTokens", 0);

  const verb = label || randomVerb();

  const [, setElapsed] = tuiUseState("elapsed", 0);

  tuiUseEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((performance.now() - start) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (data) => {
    const elapsed = intArg(data, "elapsed", 0);
    const parts: string[] = [];

    if (inputTokens > 0) {
      parts.push(`${formatTokens(inputTokens)}↓ ${formatTokens(outputTokens)}↑`);
    }

    if (elapsed > 0) {
      parts.push(`${String(elapsed)}s`);
    }

    const detail = parts.length > 0 ? ` (${parts.join(" · ")})` : "";

    return Box({
      flexDirection: "row",
      children: [
        Text({ color: "magenta", children: getDotsFrame(elapsed) }),
        Text({ dimColor: true, children: ` ${verb}${detail}` }),
      ],
    });
  };
});
