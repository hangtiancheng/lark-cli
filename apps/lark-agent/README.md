# lark-agent

AI intelligent OnCall assistant, migrated from SuperBizAgent (Go + cloudwego/eino) to Next.js 16 App Router + Vercel AI SDK.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Vercel AI SDK v7 (`streamText` / `generateText` / `generateObject` / `tool` / `embed`)
- LLM: DeepSeek-v3 (Volcengine Ark, OpenAI compatible) via `@ai-sdk/openai`
- Embedding: Alibaba DashScope text-embedding-v4 via `@ai-sdk/openai-compatible`
- Vector DB: Milvus (`@zilliz/milvus2-sdk-node`, db=agent, collection=biz, BinaryVector)
- MySQL: `knex` + `mysql2`
- MCP: `@modelcontextprotocol/sdk` (SSE log tools)
- Frontend: Tailwind v4 atomic classes + `react-markdown` + `highlight.js`

## Getting started

1. Copy `.env.example` to `.env` and fill in API keys.
2. Ensure Milvus is running at `MILVUS_ADDRESS` (default `localhost:19530`).
3. (Optional) Start Prometheus at `PROMETHEUS_BASE_URL` for alert queries.
4. (Optional) Start the MCP log server at `MCP_URL`.
5. Install deps and run:

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## APIs

- `POST /api/chat` — non-streaming chat
- `POST /api/chat_stream` — SSE streaming chat
- `POST /api/upload` — upload a file (.txt/.md) to the knowledge base
- `POST /api/ai_ops` — AI Ops plan-execute-replan

## Notes

- On first use, upload a doc file via the "..." menu so the RAG knowledge base has content; otherwise retrieval returns empty.
- Embeddings are stored as BinaryVector (float32 bytes reinterpreted as binary, HAMMING metric), matching the source project.
- Tool definitions follow a three-layer split: `schemas.ts` (zod) → `operations.ts` (pure functions) → `index.ts` (AI SDK `tool` wrapper).
