export {
  deleteProjectFile,
  modifyProjectFile,
  readProjectDir,
  readProjectFile,
  writeProjectFile,
} from "./file-operations.js";
export {
  dirReadInputSchema,
  exitInputSchema,
  fileDeleteInputSchema,
  fileModifyInputSchema,
  fileReadInputSchema,
  fileWriteInputSchema,
} from "./file-tool-schemas.js";
export {
  createDirReadTool,
  createExitTool,
  createFileDeleteTool,
  createFileModifyTool,
  createFileReadTool,
  createFileWriteTool,
} from "./file-tools.js";
export { shellExecInputSchema } from "./shell-tool-schemas.js";
export { createShellTool } from "./shell-tool.js";

import {
  createDirReadTool,
  createExitTool,
  createFileDeleteTool,
  createFileModifyTool,
  createFileReadTool,
  createFileWriteTool,
} from "./file-tools.js";
import { createShellTool } from "./shell-tool.js";

export const createAllTools = (workDir: string) => [
  createFileWriteTool(workDir),
  createFileReadTool(workDir),
  createFileModifyTool(workDir),
  createFileDeleteTool(workDir),
  createDirReadTool(workDir),
  createShellTool(),
  createExitTool(),
];
