import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document, type DocumentInterface } from "@langchain/core/documents";
import { OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { existsSync, readFileSync, mkdirSync, copyFileSync } from "fs";
import { basename, resolve, isAbsolute, extname } from "path";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

function createEmbeddings(): OllamaEmbeddings {
  const cfg = getConfig();
  return new OllamaEmbeddings({
    baseUrl: cfg.ai.baseUrl,
    model: cfg.rag.embeddingModel,
  });
}

export class DocumentRetriever {
  private vectorStore: MemoryVectorStore;

  constructor(vectorStore: MemoryVectorStore) {
    this.vectorStore = vectorStore;
  }

  async retrieveDocuments(query: string): Promise<DocumentInterface[]> {
    const results = await this.vectorStore.similaritySearchWithScore(query, 5);
    return results.map(([doc]) => doc);
  }

  async addDocuments(docs: Document[]): Promise<void> {
    await this.vectorStore.addDocuments(docs);
  }
}

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

export function validateFile(filePath: string): void {
  const ext = extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File type ${ext} not supported, only .md, .txt, .json files are supported`);
  }
}

export async function loadFileAsDocuments(filePath: string): Promise<Document[]> {
  const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  validateFile(absPath);
  getLogger().debug({ filePath: absPath }, "rag.loadFile");

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const content = readFileSync(absPath, "utf-8");
  const doc = new Document({
    pageContent: content,
    metadata: { source: absPath, fileName: basename(absPath) },
  });

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  return splitter.splitDocuments([doc]);
}

export async function copyFileToDocsDir(filePath: string): Promise<string> {
  const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const docsDir = getConfig().rag.docsDir;

  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  const destPath = resolve(docsDir, basename(absPath));
  copyFileSync(absPath, destPath);
  return destPath;
}

export async function createRetriever(): Promise<DocumentRetriever> {
  const vectorStore = await MemoryVectorStore.fromDocuments([], createEmbeddings());
  return new DocumentRetriever(vectorStore);
}

export function buildRagPrompt(userMessage: string, docs: DocumentInterface[]): string {
  if (docs.length === 0) return userMessage;

  let contextText = "";
  for (let i = 0; i < docs.length; i++) {
    contextText += `[Document ${i + 1}]: ${docs[i].pageContent}\n\n`;
  }

  return `Answer the user's question based on the following reference document. If the document does not contain the relevant information, please state that the information could not be found.

Reference Document:
${contextText}

User Question: ${userMessage}

Please provide an accurate and complete answer:`;
}
