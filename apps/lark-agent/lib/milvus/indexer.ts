// Corresponds to the source project's internal/ai/indexer/indexer.go
// Embeds document chunks and inserts them into Milvus (as binary vectors)
import { getMilvusClient } from "./client";
import { embedTexts, float32ToBinaryVector } from "@/lib/ai/embedder";
import { config, MILVUS_FIELDS } from "@/lib/config";

export interface IndexChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

// Inserts document chunks and returns the number of inserted records
export async function indexChunks(chunks: IndexChunk[]): Promise<number> {
  if (chunks.length === 0) return 0;
  const client = await getMilvusClient();
  const vectors = await embedTexts(chunks.map((c) => c.content));

  const fieldsData = chunks.map((chunk, i) => ({
    [MILVUS_FIELDS.id]: chunk.id,
    [MILVUS_FIELDS.vector]: float32ToBinaryVector(vectors[i]),
    [MILVUS_FIELDS.content]: chunk.content,
    [MILVUS_FIELDS.metadata]: chunk.metadata,
  }));

  await client.insert({
    collection_name: config.milvus.collection,
    fields_data: fieldsData,
  });
  // Flush to ensure data is persisted to disk, allowing immediate querying afterwards
  await client.flush({ collection_names: [config.milvus.collection] });
  return chunks.length;
}

// Queries and deletes old records by metadata._source (aligned with the deduplication logic of buildIntoIndex in the source project)
export async function deleteBySource(source: string): Promise<void> {
  const client = await getMilvusClient();
  await client.deleteEntities({
    collection_name: config.milvus.collection,
    expr: `metadata["_source"] == "${source}"`,
  });
}
