import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
let _wasmMatch = null;
let _loadPromise = null;
async function getMatch() {
    if (_wasmMatch)
        return _wasmMatch;
    if (!_loadPromise) {
        _loadPromise = import("./build/release.js").then((mod) => {
            _wasmMatch = mod.match;
            return _wasmMatch;
        });
    }
    return _loadPromise;
}
export class Glob {
    pattern;
    dot;
    isFilenameOnly;
    constructor(pattern, options) {
        this.pattern = pattern;
        this.dot = options?.dot ?? false;
        this.isFilenameOnly = !pattern.includes("/");
    }
    async match(text) {
        const wasmMatch = await getMatch();
        return wasmMatch(this.pattern, text);
    }
    async *scan(options) {
        const cwd = options?.cwd ?? ".";
        const exclude = options?.exclude;
        const wasmMatch = await getMatch();
        yield* this.walkDir(cwd, cwd, wasmMatch, exclude);
    }
    async *walkDir(dir, rootDir, wasmMatch, exclude) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const name = entry.name;
            if (entry.isDirectory()) {
                if (name.startsWith("."))
                    continue;
                if (exclude && exclude(name))
                    continue;
                yield* this.walkDir(join(dir, name), rootDir, wasmMatch, exclude);
            }
            else if (entry.isFile()) {
                if (!this.dot && name.startsWith("."))
                    continue;
                const relativePath = relative(rootDir, join(dir, name));
                const matchTarget = this.isFilenameOnly ? name : relativePath;
                if (wasmMatch(this.pattern, matchTarget)) {
                    yield relativePath;
                }
            }
        }
    }
}
export async function glob(pattern, options) {
    const g = new Glob(pattern, options);
    const results = [];
    for await (const entry of g.scan(options)) {
        results.push(entry);
    }
    return results;
}
//# sourceMappingURL=index.js.map