export interface GlobScanOptions {
    cwd?: string;
    exclude?: (name: string) => boolean;
}
export interface GlobOptions {
    dot?: boolean;
}
export declare class Glob {
    readonly pattern: string;
    readonly dot: boolean;
    private readonly isFilenameOnly;
    constructor(pattern: string, options?: GlobOptions);
    match(text: string): Promise<boolean>;
    scan(options?: GlobScanOptions): AsyncGenerator<string>;
    private walkDir;
}
export declare function glob(pattern: string, options?: GlobOptions & GlobScanOptions): Promise<string[]>;
//# sourceMappingURL=index.d.ts.map