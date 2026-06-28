import type { VDomNode } from "@lark.js/mvc";
import { defineTerminalView } from "../runtime/view-ctx.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { formatTokens } from "../../../teams/progress.js";
import { strArg, intArg } from "@/utils/index.js";
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

const TeammateSchema = z.object({
  name: z.string(),
  teamName: z.string(),
  status: z.string(),
  spinnerVerb: z.string(),
  progress: ProgressSchema,
});

type ParsedTeammate = z.infer<typeof TeammateSchema>;

const TeammatesArraySchema = z.array(TeammateSchema);

export const TeammateSpinnerTreeView = defineTerminalView(
  (_ctx, _props?: Record<string, unknown>) => {
    return (data) => {
      const teammatesRaw = data.teammates;
      const teammatesResult = TeammatesArraySchema.safeParse(teammatesRaw);
      const teammates: ParsedTeammate[] = teammatesResult.success ? teammatesResult.data : [];
      const leaderVerb = strArg(data, "leaderVerb", "thinking");
      const leaderTokens = intArg(data, "leaderTokens", 0);

      if (teammates.length === 0) {
        return Box({ children: [] });
      }

      const tokenSuffix = leaderTokens > 0 ? ` · ${formatTokens(leaderTokens)} tokens` : "";

      const children: VDomNode[] = [
        Text({
          children: [
            Text({ color: "cyan", children: `  ┌─ team-lead: ${leaderVerb}…` }),
            Text({ dimColor: true, children: tokenSuffix }),
          ],
        }),
      ];

      for (let i = 0; i < teammates.length; i++) {
        const tm: ParsedTeammate = teammates[i];
        const isLast = i === teammates.length - 1;
        const connector = isLast ? "└─ " : "├─ ";
        const status: string = tm.status;
        const progress = tm.progress;
        const spinnerVerb: string = tm.spinnerVerb;
        const stats = ` · ${String(progress.toolUseCount)} tools · ${formatTokens(progress.tokenCount)} tokens`;

        let statusText: string;
        switch (status) {
          case "idle": {
            statusText = "idle";
            break;
          }
          case "completed": {
            statusText = "completed";
            break;
          }
          case "failed": {
            statusText = "failed";
            break;
          }
          case "stopped": {
            statusText = "stopped";
            break;
          }
          case "running": {
            statusText = spinnerVerb;
            break;
          }
          default: {
            statusText = status;
          }
        }

        children.push(
          Box({
            children: [
              Text({
                children: [
                  "  ",
                  Text({ dimColor: true, children: connector }),
                  Text({ color: "cyan", children: `@${tm.name}` }),
                  ": ",
                  Text({ dimColor: true, children: statusText }),
                  Text({ dimColor: true, children: stats }),
                ],
              }),
            ],
          }),
        );
      }

      return Box({
        paddingTop: 1,
        children,
      });
    };
  },
);
