import { useCallback, useRef, useState } from "react";
import { startPreviewServer, type PreviewServerHandle } from "../engine/preview/preview-server.js";

export type PreviewState = "idle" | "starting" | "running" | "error";

export const usePreviewServer = () => {
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const handleRef = useRef<PreviewServerHandle | null>(null);

  const start = useCallback(async (projectDir: string) => {
    if (handleRef.current) {
      await handleRef.current.close();
    }
    setPreviewState("starting");
    try {
      const handle = await startPreviewServer(projectDir);
      handleRef.current = handle;
      setPreviewUrl(handle.url);
      setPreviewState("running");
      return handle.url;
    } catch {
      setPreviewState("error");
      return undefined;
    }
  }, []);

  const stop = useCallback(async () => {
    if (handleRef.current) {
      await handleRef.current.close();
      handleRef.current = null;
    }
    setPreviewState("idle");
    setPreviewUrl("");
  }, []);

  return { previewState, previewUrl, start, stop };
};
