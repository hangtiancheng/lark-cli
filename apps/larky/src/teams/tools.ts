import { asErrorString, strArg } from "@/utils/index.js";
import type { Tool, ToolContext, ToolResult, ToolSchema } from "../tools/types.js";
import type { TeamManager, RunAgent } from "./team.js";

export class TeamCreateTool implements Tool {
  name = "TeamCreate";
  description = "Create a team for coordinating multiple agents.";
  category = "read" as const;
  system = true;
  constructor(private mgr: TeamManager) {}
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Team name",
          },
        },
        required: ["name"],
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const name = strArg(args, "name");
    if (!name) {
      return Promise.resolve({
        output: "Error: name is required",
        isError: true,
      });
    }
    if (this.mgr.get(name)) {
      return Promise.resolve({
        output: `Team '${name}' already exists.`,
        isError: false,
      });
    }
    this.mgr.create(name);
    return Promise.resolve({
      output: `Team '${name}' created.`,
      isError: false,
    });
  }
}

export class SpawnTeammateTool implements Tool {
  name = "SpawnTeammate";
  description =
    "Spawn a teammate in a team to work on a task in the background. Its result is delivered back to you on the team channel when it finishes.";
  category = "read" as const;
  system = true;
  constructor(
    private mgr: TeamManager,
    private runAgent: RunAgent,
  ) {}
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          team: {
            type: "string",
            description: "Team name (created if missing)",
          },
          name: {
            type: "string",
            description: "Teammate name",
          },
          task: {
            type: "string",
            description: "The task for the teammate",
          },
        },
        required: ["team", "name", "task"],
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const team = strArg(args, "team");
    const name = strArg(args, "name");
    const task = strArg(args, "task");
    if (!team || !name || !task) {
      return Promise.resolve({
        output: "Error: team, name and task are required",
        isError: true,
      });
    }
    const t = this.mgr.get(team) ?? this.mgr.create(team);
    t.spawnTeammate(name, task, this.runAgent);
    return Promise.resolve({
      output: `Teammate '${name}' spawned in team '${team}'. Its result will arrive on the team channel; keep working and watch for it.`,
      isError: false,
    });
  }
}

export class SendMessageTool implements Tool {
  name = "SendMessage";
  description = "Send a message to a teammate's mailbox.";
  category = "read" as const;
  system = true;
  constructor(private mgr: TeamManager) {}
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          team: { type: "string" },
          to: {
            type: "string",
            description: "Teammate name",
          },
          message: { type: "string" },
        },
        required: ["team", "to", "message"],
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const team = strArg(args, "team");
    const to = strArg(args, "to");
    const message = strArg(args, "message");
    const t = this.mgr.get(team);
    if (!t) {
      return {
        output: `Team '${team}' not found.`,
        isError: true,
      };
    }
    try {
      await t.sendMessage("lead", to, message);
    } catch (e) {
      return {
        output: `Error: ${asErrorString(e)}`,
        isError: true,
      };
    }
    return {
      output: `Message sent to '${to}'.`,
      isError: false,
    };
  }
}

export class ListTeamsTool implements Tool {
  name = "ListTeams";
  description = "List teams and their members.";
  category = "read" as const;
  system = true;
  constructor(private mgr: TeamManager) {}
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  execute(): Promise<ToolResult> {
    const teams = this.mgr.list();
    if (teams.length === 0) {
      return Promise.resolve({
        output: "No teams.",
        isError: false,
      });
    }
    const lines = teams.map((t) => {
      const members =
        t
          .listMembers()
          .map((m) => `${m.name}${m.active ? " (active)" : ""}`)
          .join(", ") || "(no members)";
      return `${t.name} [${t.mode}]: ${members}`;
    });
    return Promise.resolve({
      output: lines.join("\n"),
      isError: false,
    });
  }
}

export class TeamDeleteTool implements Tool {
  name = "TeamDelete";
  description = "Delete a team and stop its members.";
  category = "read" as const;
  system = true;
  constructor(private mgr: TeamManager) {}
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const name = strArg(args, "name");
    await this.mgr.delete(name);
    return { output: `Team '${name}' deleted.`, isError: false };
  }
}
