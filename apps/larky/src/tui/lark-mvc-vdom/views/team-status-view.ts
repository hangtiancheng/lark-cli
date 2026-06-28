import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { intArg } from "@/utils/index.js";

export const TeamStatusView = defineTerminalView((_ctx, props?: Record<string, unknown>) => {
  const count = intArg(props ?? {}, "count", 0);

  return () => {
    if (count === 0) {
      return Box({ children: [] });
    }

    const label = count === 1 ? "teammate" : "teammates";

    return Text({
      dimColor: true,
      children: [Text({ color: "magenta", children: "●" }), ` ${String(count)} ${label}`],
    });
  };
});
