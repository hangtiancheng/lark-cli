import { loadFileAsDocuments, copyFileToDocsDir, createRetriever } from "../services/rag.js";
import type { CommandContext } from "./command-handler.js";

export async function handleRagCommand(args: string, ctx: CommandContext): Promise<void> {
  const paths = args.split(/\s+/).filter(Boolean);
  if (paths.length === 0) {
    ctx.showNotification("Usage: /rag <path1> [path2] [path3] ...");
    return;
  }

  try {
    let retriever = ctx.retriever;
    if (!retriever) {
      retriever = await createRetriever();
      ctx.setRetriever(retriever);
    }

    let totalChunks = 0;
    const results: string[] = [];

    for (const filePath of paths) {
      try {
        const docs = await loadFileAsDocuments(filePath);
        await copyFileToDocsDir(filePath);
        await retriever.addDocuments(docs);
        totalChunks += docs.length;
        results.push(`  ${filePath}: ${docs.length} chunks`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        results.push(`  ${filePath}: failed (${errMsg})`);
      }
    }

    ctx.showNotification(
      `RAG upload complete (${totalChunks} total chunks):\n${results.join("\n")}`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    ctx.showNotification(`RAG init failed: ${errMsg}`);
  }
}
