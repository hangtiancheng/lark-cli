// Corresponds to /api/chat_stream (chat_v1_chat_stream.go). SSE stream.
// Mirrors the source project's SSE framing: id / event / data, with events
// connected, message, done, error.
import { z } from "zod/v4";
import { chatStream } from "@/lib/ai/pipelines/chat";

const streamRequestSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = streamRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ message: "missing id or question", data: null }, { status: 400 });
  }
  const { id, question } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`id: ${Date.now()}\nevent: ${event}\ndata: ${data}\n\n`));
      };
      // Send a connected event first (mirrors the source SSE).
      send("connected", JSON.stringify({ status: "connected", client_id: id }));
      try {
        for await (const chunk of chatStream(id, question)) {
          send("message", chunk);
        }
        send("done", "Stream completed");
      } catch (e) {
        send("error", e instanceof Error ? e.message : String(e));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
