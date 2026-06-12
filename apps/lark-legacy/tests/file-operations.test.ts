import { describe, test, expect, vi, beforeEach } from "vitest";
import { Dirent } from "node:fs";

vi.mock(import("node:fs"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}));

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedUnlink = vi.mocked(unlink);

type ReaddirWithFileTypes = (
  path: string,
  options: { withFileTypes: true },
) => Promise<Dirent<string>[]>;

const mockedReaddir = readdir as unknown as ReturnType<typeof vi.fn<ReaddirWithFileTypes>>;

import {
  readProjectFile,
  writeProjectFile,
  modifyProjectFile,
  deleteProjectFile,
  readProjectDir,
} from "../src/engine/ai/tools/file-operations.js";

class MockDirent extends Dirent<string> {
  private _isDir: boolean;
  constructor(name: string, parentPath: string, isDir: boolean) {
    super();
    this.name = name;
    this.parentPath = parentPath;
    this._isDir = isDir;
  }
  override isDirectory(): boolean {
    return this._isDir;
  }
  override isFile(): boolean {
    return !this._isDir;
  }
}

const WORK_DIR = "/tmp/test-project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readProjectFile", () => {
  test("returns file content when file exists", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue("hello world");

    const result = await readProjectFile(WORK_DIR, "readme.txt");
    expect(result).toBe("hello world");
  });

  test("returns not-found message when file does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await readProjectFile(WORK_DIR, "missing.txt");
    expect(result).toBe("File not found: missing.txt");
  });

  test("rejects path traversal", async () => {
    await expect(readProjectFile(WORK_DIR, "../../../etc/passwd")).rejects.toThrow(
      "Path traversal",
    );
  });
});

describe("writeProjectFile", () => {
  test("writes file and returns confirmation", async () => {
    mockedWriteFile.mockResolvedValue();

    const result = await writeProjectFile(WORK_DIR, "src/app.ts", "const x = 1;");
    expect(result).toBe("File written: src/app.ts");
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("src/app.ts"),
      "const x = 1;",
      "utf-8",
    );
  });

  test("rejects path traversal", async () => {
    await expect(writeProjectFile(WORK_DIR, "../../hack.sh", "rm -rf /")).rejects.toThrow(
      "Path traversal",
    );
  });
});

describe("modifyProjectFile", () => {
  test("replaces search string in file", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue("hello world");
    mockedWriteFile.mockResolvedValue();

    const result = await modifyProjectFile(WORK_DIR, "file.txt", "hello", "hi");
    expect(result).toBe("File modified: file.txt");
    expect(mockedWriteFile).toHaveBeenCalledWith(expect.any(String), "hi world", "utf-8");
  });

  test("returns not-found when file does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await modifyProjectFile(WORK_DIR, "missing.txt", "a", "b");
    expect(result).toBe("File not found: missing.txt");
  });

  test("returns error when search string is not found", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue("hello world");

    const result = await modifyProjectFile(WORK_DIR, "file.txt", "xyz", "abc");
    expect(result).toBe("Search string not found in file: file.txt");
  });
});

describe("deleteProjectFile", () => {
  test("deletes file and returns confirmation", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedUnlink.mockResolvedValue();

    const result = await deleteProjectFile(WORK_DIR, "temp.log");
    expect(result).toBe("File deleted: temp.log");
    expect(mockedUnlink).toHaveBeenCalled();
  });

  test("rejects deletion of protected files", async () => {
    const protectedFiles = [
      "package.json",
      "vite.config.ts",
      "vite.config.js",
      "index.html",
      "tsconfig.json",
      "tsconfig.node.json",
    ];

    for (const f of protectedFiles) {
      const result = await deleteProjectFile(WORK_DIR, f);
      expect(result).toContain("Cannot delete protected file");
    }
  });

  test("returns not-found when file does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await deleteProjectFile(WORK_DIR, "ghost.txt");
    expect(result).toBe("File not found: ghost.txt");
  });
});

describe("readProjectDir", () => {
  test("returns not-found for nonexistent directory", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await readProjectDir(WORK_DIR, "nonexistent");
    expect(result).toBe("Directory not found: nonexistent");
  });

  test("lists directory entries", async () => {
    mockedExistsSync.mockReturnValue(true);

    const entries: Dirent<string>[] = [
      new MockDirent("src", WORK_DIR, true),
      new MockDirent("README.md", WORK_DIR, false),
    ];

    mockedReaddir.mockResolvedValueOnce(entries);
    mockedReaddir.mockResolvedValueOnce([]);

    const result = await readProjectDir(WORK_DIR);
    expect(result).toContain("src/");
    expect(result).toContain("README.md");
  });

  test("does not call mkdir (no write side effect)", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddir.mockResolvedValueOnce([]);

    await readProjectDir(WORK_DIR);

    const { mkdir } = await import("node:fs/promises");
    expect(mkdir).not.toHaveBeenCalled();
  });
});
