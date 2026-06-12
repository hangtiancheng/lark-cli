// CLI version command: print package version
import { version } from "../../index.js";

export function cmdVersion(): void {
  console.log(`lark ${version}`);
}
