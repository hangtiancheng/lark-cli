// Corresponds to the source project's internal/ai/retriever/retriever.go
// Milvus vector retrieval (TopK=1, aligned with the source project)
import { getMilvusClient } from "./client";
import { embedText, float32ToBinaryVector } from "@/lib/ai/embedder";
import { config, MILVUS_FIELDS } from "@/lib/config";

export interface RetrievedDoc {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export async function retrieve(query: string, topK = 1): Promise<RetrievedDoc[]> {
  const client = await getMilvusClient();
  const vec = float32ToBinaryVector(await embedText(query));

  const res = await client.search({
    collection_name: config.milvus.collection,
    data: [vec],
    anns_field: MILVUS_FIELDS.vector,
    limit: topK,
    output_fields: [MILVUS_FIELDS.id, MILVUS_FIELDS.content, MILVUS_FIELDS.metadata],
  });

  const results = (res.results ?? []) as Array<Record<string, unknown>>;
  return results.map((r) => ({
    id: String(r[MILVUS_FIELDS.id] ?? ""),
    content: String(r[MILVUS_FIELDS.content] ?? ""),
    metadata: (r[MILVUS_FIELDS.metadata] ?? {}) as Record<string, unknown>,
    score: Number(r.score ?? 0),
  }));
}
