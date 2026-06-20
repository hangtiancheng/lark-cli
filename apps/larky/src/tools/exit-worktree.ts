import { asErrorString } from "../utils/index.js";
import {
  hasWorktreeChanges,
  removeAgentWorktree,
} from "../worktree/worktree.js";
import {
  strArg,
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

export class ExitWorktreeTool implements Tool {
  name = ExitWorktreeTool.name.replace("Tool", "");
  description = "Exit and optionally cleanup a git worktree";

  category: ToolCategory = "write";
  deferred = true;

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Worktree path" },
          branch: { type: "string", description: "Worktree branch name" },
          git_root: { type: "string", description: "Git root directory" },
          head_commit: {
            type: "string",
            description: "Original HEAD commit for change detection",
          },
        },
        required: ["path", "branch", "git_root"],
      },
    };
  }

  async execute(
    ctx: ToolContext,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const path = strArg(args, "path");
    const branch = strArg(args, "branch");
    const gitRoot = strArg(args, "git_root");
    const headCommit = strArg(args, "head_commit");

    if (!path || !branch || !gitRoot) {
      return {
        output: "Error: path, branch and git_root are required",
        isError: true,
      };
    }

    const hasChanges = headCommit
      ? hasWorktreeChanges(path, headCommit)
      : false;

    if (!hasChanges) {
      try {
        await removeAgentWorktree(path, branch, gitRoot);
        return {
          output: `Worktree cleaned up (no changes): ${path}`,
          isError: false,
        };
      } catch (err) {
        return {
          output: `Error cleaning up worktree: ${asErrorString(err)}`,
          isError: true,
        };
      }
    }

    return {
      output: `Worktree has changes, kept at: ${path}\nBranch: ${branch}`,
      isError: false,
    };
  }
}
