// Corresponds to the source project's internal/ai/embedder/embedder.go
// DashScope text-embedding-v4 (OpenAI compatible) via @ai-sdk/openai-compatible
import { embed, embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config, EMBEDDING_DIM, BINARY_VECTOR_BYTES } from "@/lib/config";

// DashScope provider (OpenAI compatible interface)
const dashscope = createOpenAICompatible({
  name: "dashscope",
  baseURL: config.dashscope.baseURL,
  apiKey: config.dashscope.apiKey,
});

export const embeddingModel = dashscope.textEmbeddingModel(config.dashscope.model);

// Get float embedding for a single text (2048-dimensional)
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

// Batch get embeddings
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  return embeddings;
}

/**
 * Float32 array → BinaryVector bytes (8192 bytes = 65536 bits).
 * Aligned with the source project: stores the raw byte stream of 2048 float32s as a BinaryVector, using HAMMING metric.
 * (2048 float32 × 4 bytes × 8 bits = 65536 bits)
 */
export function float32ToBinaryVector(floats: number[]): Buffer {
  if (floats.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim mismatch: expected ${EMBEDDING_DIM}, got ${floats.length}`);
  }
  const arr = new Float32Array(floats);
  const buf = Buffer.from(arr.buffer);
  if (buf.length !== BINARY_VECTOR_BYTES) {
    throw new Error(
      `binary vector bytes mismatch: expected ${BINARY_VECTOR_BYTES}, got ${buf.length}`,
    );
  }
  return buf;
}
