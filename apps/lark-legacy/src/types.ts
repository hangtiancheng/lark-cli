export interface Message {
  id?: number;
  sessionId: string;
  content: string;
  isUser: boolean;
  createdAt?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const ModelType = {
  OLLAMA: "ollama",
  OLLAMA_RAG: "ollama-rag",
} as const;

export type ModelType = (typeof ModelType)[keyof typeof ModelType];

export type StreamCallback = (chunk: string) => void;
