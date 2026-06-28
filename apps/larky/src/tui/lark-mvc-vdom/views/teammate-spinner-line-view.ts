import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { summarizeActivities, formatTokens } from "../../../teams/progress.js";
import { boolArg } from "@/utils/index.js";
import { z } from "zod";

const ToolActivitySchema = z.object({
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  activityDescription: z.string(),
});

const ProgressSchema = z.object({
  toolUseCount: z.number(),
  tokenCount: z.number(),
  lastActivity: ToolActivitySchema.optional(),
  recentActivities: z.array(ToolActivitySchema),
});

const StateSchema = z.object({
  name: z.string(),
  teamName: z.string(),
  status: z.string(),
  spinnerVerb: z.string(),
  progress: ProgressSchema,
});

type ParsedState = z.infer<typeof StateSchema>;

function renderStatus(
  status: string,
  progress: ParsedState["progress"],
  spinnerVerb: string,
): VDomNode {
  switch (status) {
    case "idle": {
      return Text({ dimColor: true, children: "idle" });
    }
    case "completed": {
      return Text({ color: "green", children: "completed" });
    }
    case "failed": {
      return Text({ color: "red", children: "failed" });
    }
    case "stopped": {
      return Text({ color: "yellow", children: "stopped" });
    }
    case "running": {
      const summary = summarizeActivities(progress.recentActivities);
      const label = summary.length > 0 ? summary : spinnerVerb;
      return Text({
        dimColor: true,
        children: label + (summary ? "..." : ""),
      });
    }
    default: {
      return Text({ children: status });
    }
  }
}

export const TeammateSpinnerLineView = defineTerminalView(
  (_ctx, _props?: Record<string, unknown>) => {
    return (data) => {
      const isLast = boolArg(data, "isLast", false);
      const isSelected = boolArg(data, "isSelected", false);

      const stateRaw = data.state;
      const stateResult = StateSchema.safeParse(stateRaw);
      if (!stateResult.success) {
        return Box({ children: [] });
      }

      const state = stateResult.data;
      const status: string = state.status;
      const spinnerVerb: string = state.spinnerVerb;
      const progress = {
        ...state.progress,
        lastActivity: state.progress.lastActivity,
      };

      const pointer = isSelected ? "> " : "  ";
      let connector: string;

      if (isSelected && isLast) {
        connector = "╘═ ";
      } else if (isSelected) {
        connector = "╞═ ";
      } else if (isLast) {
        connector = "└─ ";
      } else {
        connector = "├─ ";
      }

      const stats = ` · ${String(progress.toolUseCount)} tools · ${formatTokens(progress.tokenCount)} tokens`;

      return Box({
        children: [
          Text({
            children: [
              pointer,
              Text({ dimColor: true, children: connector }),
              Text({ color: "cyan", children: `@${state.name}` }),
              ": ",
              renderStatus(status, progress, spinnerVerb),
              Text({ dimColor: true, children: stats }),
            ],
          }),
        ],
      });
    };
  },
);
