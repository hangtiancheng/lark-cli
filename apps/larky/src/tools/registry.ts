import type { Tool, ToolSchema } from "./types.js";

export class ToolRegistry {
	private tools = new Map<string, Tool>();
	private discovered = new Set<string>();

	register(tool: Tool): void {
		this.tools.set(tool.name, tool);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	listTools(): Tool[] {
		return [...this.tools.values()];
	}

	getAllSchemas(): ToolSchema[] {
		const schemas: ToolSchema[] = [];
		const allTools = this.tools.values();
		for (const tool of allTools) {
			if (tool.deferred && !this.discovered.has(tool.name)) {
				continue;
			}
			schemas.push(tool.schema());
		}
		return schemas;
	}

	getDeferredToolNames(): string[] {
		const names: string[] = [];
		for (const tool of this.tools.values()) {
			if (tool.deferred && !this.discovered.has(tool.name)) {
				names.push(tool.name);
			}
		}
		return names;
	}

	getDeferredTools(): Tool[] {
		return [...this.tools.values()].filter(
			(t) => t.deferred && !this.discovered.has(t.name),
		);
	}

	searchDeferred(query: string, maxResults = 5): Tool[] {
		const lower = query.toLowerCase();
		const matches: Tool[] = [];
		for (const tool of this.tools.values()) {
			if (!tool.deferred || this.discovered.has(tool.name)) continue;
			if (
				tool.name.toLowerCase().includes(lower) ||
				tool.description.toLowerCase().includes(lower)
			) {
				matches.push(tool);
				if (matches.length >= maxResults) break;
			}
		}
		return matches;
	}

	findDeferredByNames(names: string[]): Tool[] {
		return names
			.map((n) => this.tools.get(n))
			.filter((t): t is Tool => t?.deferred ?? false);
	}

	markDiscovered(name: string): void {
		this.discovered.add(name);
	}

	isDiscovered(name: string): boolean {
		return this.discovered.has(name);
	}
}
