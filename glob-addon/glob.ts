import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const binding = require("../build/Release/glob_addon.node") as {
	globMatch: (pattern: string, text: string) => boolean;
	globScan: (
		pattern: string,
		cwd: string | null,
		excludeDirs: string[] | null,
		dot: boolean | null,
		maxResults: number | null,
	) => string[];
};

export interface GlobScanOptions {
	cwd?: string;
	exclude?: string[];
	dot?: boolean;
	maxResults?: number;
}

export interface GlobOptions {
	dot?: boolean;
}

export class Glob {
	readonly pattern: string;
	readonly dot: boolean;

	constructor(pattern: string, options?: GlobOptions) {
		this.pattern = pattern;
		this.dot = options?.dot ?? false;
	}

	match(text: string): boolean {
		return binding.globMatch(this.pattern, text);
	}

	scan(options?: GlobScanOptions): string[] {
		return binding.globScan(
			this.pattern,
			options?.cwd ?? null,
			options?.exclude ?? null,
			options?.dot ?? this.dot ?? null,
			options?.maxResults ?? null,
		);
	}
}
