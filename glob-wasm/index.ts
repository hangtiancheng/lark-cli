import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

// Lazy-loaded WASM match function type
type WasmMatch = (pattern: string, text: string) => boolean;

let _wasmMatch: WasmMatch | null = null;
let _loadPromise: Promise<WasmMatch> | null = null;

async function getMatch(): Promise<WasmMatch> {
	if (_wasmMatch) return _wasmMatch;
	if (!_loadPromise) {
		_loadPromise = import("./build/release.js").then((mod) => {
			_wasmMatch = mod.match as WasmMatch;
			return _wasmMatch;
		});
	}
	return _loadPromise;
}

export interface GlobScanOptions {
	cwd?: string;
	exclude?: (name: string) => boolean;
}

export interface GlobOptions {
	dot?: boolean;
}

export class Glob {
	readonly pattern: string;
	readonly dot: boolean;
	private readonly isFilenameOnly: boolean;

	constructor(pattern: string, options?: GlobOptions) {
		this.pattern = pattern;
		this.dot = options?.dot ?? false;
		this.isFilenameOnly = !pattern.includes("/");
	}

	async match(text: string): Promise<boolean> {
		const wasmMatch = await getMatch();
		return wasmMatch(this.pattern, text);
	}

	async *scan(options?: GlobScanOptions): AsyncGenerator<string> {
		const cwd = options?.cwd ?? ".";
		const exclude = options?.exclude;
		const wasmMatch = await getMatch();
		yield* this.walkDir(cwd, cwd, wasmMatch, exclude);
	}

	private async *walkDir(
		dir: string,
		rootDir: string,
		wasmMatch: WasmMatch,
		exclude?: (name: string) => boolean,
	): AsyncGenerator<string> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of entries) {
			const name = entry.name;

			if (entry.isDirectory()) {
				if (name.startsWith(".")) continue;
				if (exclude && exclude(name)) continue;
				yield* this.walkDir(join(dir, name), rootDir, wasmMatch, exclude);
			} else if (entry.isFile()) {
				if (!this.dot && name.startsWith(".")) continue;
				const relativePath = relative(rootDir, join(dir, name));
				const matchTarget = this.isFilenameOnly ? name : relativePath;
				if (wasmMatch(this.pattern, matchTarget)) {
					yield relativePath;
				}
			}
		}
	}
}

export async function glob(
	pattern: string,
	options?: GlobOptions & GlobScanOptions,
): Promise<string[]> {
	const g = new Glob(pattern, options);
	const results: string[] = [];
	for await (const entry of g.scan(options)) {
		results.push(entry);
	}
	return results;
}
