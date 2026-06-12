import { createServer, type Server } from "node:http";
import { exec } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

export type PreviewServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

const openBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
};

export const startPreviewServer = (
  rootDir: string,
  preferredPort = 4173,
  autoOpen = true,
): Promise<PreviewServerHandle> =>
  new Promise((resolve, reject) => {
    const distDir = existsSync(join(rootDir, "dist")) ? join(rootDir, "dist") : rootDir;

    const server: Server = createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] ?? "/";
      const filePath = urlPath === "/" ? join(distDir, "index.html") : join(distDir, urlPath);

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        const indexFallback = join(distDir, "index.html");
        if (existsSync(indexFallback)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          createReadStream(indexFallback).pipe(res);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      createReadStream(filePath).pipe(res);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        server.listen(0, "127.0.0.1");
      } else {
        reject(err);
      }
    });

    server.on("listening", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const port = addr.port;
        const url = `http://localhost:${port}`;
        if (autoOpen) {
          openBrowser(url);
        }
        resolve({
          url,
          port,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      }
    });

    server.listen(preferredPort, "127.0.0.1");
  });
