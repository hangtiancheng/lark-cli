import { asErrorString } from "../utils/index.js";
import { createAgentWorktree } from "../worktree/worktree.js";
import {
	strArg,
	type Tool,
	type ToolCategory,
	type ToolContext,
	type ToolResult,
	type ToolSchema,
} from "./types.js";

export class EnterWorktreeTool implements Tool {
	name: string = EnterWorktreeTool.name.replace("Tool", "");

	description = "Create and enter a git worktree for isolated work.";

	category: ToolCategory = "write";

	deferred = true;

	system?: boolean;
	schema(): ToolSchema {
		const inputSchema = {
			type: "object" as const,
			properties: {
				slug: {
					type: "string" as const,
					description: "Short identifier of the worktree",
				},
			},
			required: ["slug"],
		};

		return {
			name: this.name,
			description: this.description,
			input_schema: inputSchema,
			function: {
				name: this.name,
				description: this.description,
				parameters: inputSchema,
			},
		};
	}

	async execute(
		ctx: ToolContext,
		args: Record<string, unknown>,
	): Promise<ToolResult> {
		const slug = strArg(args, "slug");
		if (!slug) {
			return Promise.resolve({
				output: "Error: slug is required",
				isError: true,
			});
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
			return Promise.resolve({
				output:
					"Error: slug must contain only alphanumeric, hyphen, underscore",
				isError: true,
			});
		}

		try {
			const result = await createAgentWorktree(slug);
			return {
				output: `Worktree created at ${result.path}\nBranch: ${result.branch}\nHead: ${result.headCommit}`,
				isError: false,
			};
		} catch (err) {
			console.error(err);
			return {
				output: `Error creating worktree: ${asErrorString(err)}`,
				isError: true,
			};
		}
	}
}
