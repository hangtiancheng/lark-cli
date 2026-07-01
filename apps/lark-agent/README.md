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
- The plan-execute-replan pipeline uses an `AsyncGenerator` event stream, inspired by mewcode-typescript.
  This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
