import { tool } from "@langchain/core/tools";
import {
  deleteProjectFile,
  modifyProjectFile,
  readProjectDir,
  readProjectFile,
  writeProjectFile,
} from "./file-operations.js";
import {
  dirReadInputSchema,
  exitInputSchema,
  fileDeleteInputSchema,
  fileModifyInputSchema,
  fileReadInputSchema,
  fileWriteInputSchema,
} from "./file-tool-schemas.js";

export const createFileWriteTool = (workDir: string) =>
  tool((input) => writeProjectFile(workDir, input.filepath, input.content), {
    description: "Write content to a relative file path.",
    name: "FileWrite",
    schema: fileWriteInputSchema,
  });

export const createFileReadTool = (workDir: string) =>
  tool((input) => readProjectFile(workDir, input.filePath), {
    description: "Read content from a relative file path.",
    name: "FileRead",
    schema: fileReadInputSchema,
  });

export const createFileModifyTool = (workDir: string) =>
  tool((input) => modifyProjectFile(workDir, input.filePath, input.searchStr, input.replaceStr), {
    description: "Modify a file by replacing the first matching search string.",
    name: "FileModify",
    schema: fileModifyInputSchema,
  });

export const createFileDeleteTool = (workDir: string) =>
  tool((input) => deleteProjectFile(workDir, input.filePath), {
    description: "Delete a non-protected file at a relative path.",
    name: "FileDelete",
    schema: fileDeleteInputSchema,
  });

export const createDirReadTool = (workDir: string) =>
  tool((input) => readProjectDir(workDir, input.dirPath), {
    description: "Read the directory tree below a relative path.",
    name: "ReadDir",
    schema: dirReadInputSchema,
  });

export const createExitTool = () =>
  tool((input) => Promise.resolve(input.reason ?? "Task completed"), {
    description: "Signal that the coding task is complete.",
    name: "Exit",
    schema: exitInputSchema,
  });
