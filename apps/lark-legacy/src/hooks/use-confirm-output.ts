import { useCallback, useState } from "react";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";

export type ConfirmState = "pending" | "copying" | "done" | "cancelled";

export const useConfirmOutput = () => {
  const [confirmState, setConfirmState] = useState<ConfirmState>("pending");
  const [targetDir, setTargetDir] = useState<string>("");

  const confirm = useCallback(async (sourceDir: string, destDir: string) => {
    setConfirmState("copying");
    setTargetDir(destDir);
    const target = resolve(destDir);
    await cp(sourceDir, target, { recursive: true });
    setConfirmState("done");
  }, []);

  const cancel = useCallback(() => {
    setConfirmState("cancelled");
  }, []);

  const reset = useCallback(() => {
    setConfirmState("pending");
    setTargetDir("");
  }, []);

  return { confirmState, targetDir, confirm, cancel, reset };
};
