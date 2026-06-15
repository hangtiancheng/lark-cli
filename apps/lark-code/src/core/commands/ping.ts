// lark ping command: send ping to core daemon and print pong response
import net from "node:net";
import { performance } from "node:perf_hooks";

import { version } from "../../index.js";
import type { LarkConfig } from "../config.js";
import { safeParseAsync } from "zod";
import { JsonRpcErrorObjectSchema, PongResultSchema } from "../bus/index.js";

// Send ping request to core daemon, print pong response with latency
export async function cmdPing(config: LarkConfig): Promise<void> {
  const t0 = performance.now();

  const socket = net.createConnection(config.port, config.host);

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("error", (err: Error) => {
      console.error(`error: core not running (${config.host}:${String(config.port)})`);
      reject(err);
    });
  });

  const req = {
    jsonrpc: "2.0" as const,
    id: "cli-1",
    method: "core.ping",
    params: { client: `cli/${version}` },
  };

  socket.write(JSON.stringify(req) + "\n", "utf-8");

  const data = await new Promise<Buffer>((resolve) => {
    socket.once("data", resolve);
  });

  const latencyMs = Math.round(performance.now() - t0);
  socket.destroy();
  const raw: unknown = JSON.parse(data.toString());
  if (typeof raw !== "object" || raw === null) {
    console.error("error: invalid response from core");
    process.exit(1);
  }
  if ("error" in raw) {
    const err = raw.error;
    const { success, data } = await safeParseAsync(JsonRpcErrorObjectSchema, err);
    if (success) {
      console.error(`error: ${String(data.code)} ${data.message}`);
    }
    process.exit(1);
  }

  const result: unknown = "result" in raw ? raw.result : undefined;
  const { data: resData, success } = await safeParseAsync(PongResultSchema, result);
  if (success) {
    console.log(
      `pong server=${resData.server_version} uptime=${String(resData.uptime_ms)}ms latency=${String(latencyMs)}ms`,
    );
  }
}
