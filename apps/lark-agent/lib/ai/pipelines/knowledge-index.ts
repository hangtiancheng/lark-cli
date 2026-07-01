// Corresponds to knowledge_index_pipeline (orchestration.go, transformer.go).
// FileLoader → MarkdownHeaderSplitter → MilvusIndexer
import { randomUUID } from "node:crypto";
import { loadFile } from "../loader";
import { indexChunks, deleteBySource, type IndexChunk } from "@/lib/milvus/indexer";

interface MarkdownChunk {
  content: string;
  title: string;
}

// Split markdown by '#' headers (corresponds to markdown.HeaderSplitter with
// HeaderConfig { "#": "title" }, TrimHeaders: false — the header line is kept
// at the start of each chunk's content).
function splitMarkdownByHeader(content: string): MarkdownChunk[] {
  const lines = content.split("\n");
  const chunks: MarkdownChunk[] = [];
  let title = "";
  let acc: string[] = [];

  const flush = () => {
    if (acc.length > 0) {
      chunks.push({ content: acc.join("\n"), title });
    }
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flush();
      title = line.slice(2).trim();
      acc = [line];
    } else {
      acc.push(line);
    }
  }
  flush();
  return chunks;
}

// Build the knowledge index for a file: delete old records with the same
// _source, split by markdown headers, embed and insert (corresponds to
// buildIntoIndex in chat_v1_file_upload.go).
export async function buildKnowledgeIndex(filePath: string): Promise<number> {
  const doc = await loadFile(filePath);
  await deleteBySource(doc.source);
  const parts = splitMarkdownByHeader(doc.content);
  const chunks: IndexChunk[] = parts.map((p) => ({
    id: randomUUID(),
    content: p.content,
    metadata: { _source: doc.source, title: p.title },
  }));
  return indexChunks(chunks);
}
