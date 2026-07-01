// Corresponds to /api/upload (chat_v1_file_upload.go).
// Save the uploaded file, then build the knowledge index for it.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { buildKnowledgeIndex } from "@/lib/ai/pipelines/knowledge-index";

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
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { message: "no file uploaded", data: null },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    await mkdir(config.fileDir, { recursive: true });
    const filePath = path.join(config.fileDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);
    await buildKnowledgeIndex(filePath);
    return Response.json(
      {
        message: "OK",
        data: { fileName: file.name, filePath, fileSize: file.size },
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : String(e), data: null },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
