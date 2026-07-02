// Corresponds to the source project's internal/ai/retriever/retriever.go
// Milvus vector retrieval (TopK=1, aligned with the source project)
import { z } from "zod/v4";
import { getMilvusClient } from "./client";
import { embedText, float32ToBinaryVector } from "@/lib/ai/embedder";
import { config, MILVUS_FIELDS } from "@/lib/config";

export interface RetrievedDoc {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

// Validate the runtime shape of a Milvus search result row (fields come back
// as unknown from the SDK, so we parse with zod instead of casting).
const searchResultSchema = z
  .looseObject({
    id: z.unknown(),
    content: z.unknown(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    score: z.number().optional(),
  });

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

  const results = z.array(searchResultSchema).parse(res.results ?? []);
  return results.map((r) => ({
    id: String(r.id ?? ""),
    content: String(r.content ?? ""),
    metadata: r.metadata ?? {},
    score: r.score ?? 0,
  }));
}
