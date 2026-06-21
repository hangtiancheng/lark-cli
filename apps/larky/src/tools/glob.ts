import { statSync } from "fs";
import { Glob } from "@lark.js/glob-wasm";
import { join } from "path";
import { asErrorString } from "../utils/index.js";
import { GLOB_DESCRIPTION } from "./descriptions.js";
import {
	SKIP_DIRS,
	strArg,
	type Tool,
	type ToolCategory,
	type ToolContext,
	type ToolResult,
	type ToolSchema,
} from "./types.js";

export class GlobTool implements Tool {
	name = GlobTool.name.replace("Tool", "");
	description = GLOB_DESCRIPTION;
	category: ToolCategory = "read";

	schema(): ToolSchema {
		const inputSchema = {
			type: "object" as const,
			properties: {
				pattern: {
					type: "string" as const,
					description: "Glob pattern (e.g., '**/*.ts', '**/*.go')",
				},
				path: {
					type: "string" as const,
					description: "Base directory to search from",
					default: ".",
				},
			},
			required: ["pattern"],
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
		const pattern = strArg(args, "pattern");
		if (!pattern) {
			return {
				output: "Error: pattern is required",
				isError: true,
			};
		}

		const basePath = strArg(args, "path", ctx.workDir);
		try {
			const matches: string[] = [];
			const g = new Glob(pattern);

			for await (const entry of g.scan({
				cwd: basePath,
				exclude: (name: string) => name.startsWith(".") || SKIP_DIRS.has(name),
			})) {
				matches.push(entry);
				if (matches.length >= 1000) break;
			}

			matches.sort((a, b) => {
				try {
					const ma = statSync(join(basePath, a)).mtimeMs;
					const mb = statSync(join(basePath, b)).mtimeMs;
					return mb - ma;
				} catch {
					return a.localeCompare(b);
				}
			});

			if (matches.length === 0) {
				return {
					output: "No files matched the pattern.",
					isError: false,
				};
			}

			return {
				output: matches.join("\n"),
				isError: false,
			};
		} catch (err) {
			return {
				output: `Error: ${asErrorString(err)}`,
				isError: true,
			};
		}
	}
}
