// Corresponds to /api/chat (chat_v1_chat.go).
// Unified response shape { message, data } mirrors ResponseMiddleware.
import { z } from "zod/v4";
import { chat } from "@/lib/ai/pipelines/chat";

const chatRequestSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { message: "missing id or question", data: null },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const { id, question } = parsed.data;
    const answer = await chat(id, question);
    return Response.json({ message: "OK", data: { answer } }, { headers: CORS_HEADERS });
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : String(e), data: null },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
