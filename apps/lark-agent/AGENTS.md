<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# lark-agent

AI intelligent OnCall assistant, migrated from SuperBizAgent (Go + cloudwego/eino). Brand: lark-agent.

## Tech stack

- Next.js 16 App Router + React 19 + TypeScript
- Vercel AI SDK v7 (`ai`): streamText / generateText / generateObject / tool / embed / embedMany
- LLM: DeepSeek-v3 (Volcengine Ark, OpenAI compatible) via `@ai-sdk/openai` createOpenAI
- Embedding: Alibaba DashScope text-embedding-v4 via `@ai-sdk/openai-compatible`
- Vector DB: Milvus (`@zilliz/milvus2-sdk-node`, db=agent, collection=biz, BinaryVector dim 65536)
- MySQL: `knex` + `mysql2` (mysql_crud tool uses knex.raw for dynamic SQL)
- MCP: `@modelcontextprotocol/sdk` (SSE log tools)
- Frontend: Tailwind v4 atomic classes + react-markdown + highlight.js

## Directory layout

- `app/` — Next.js App Router (page / layout / api route)
- `lib/` — server-side logic (ai / milvus / memory / config / api-schemas)
- `components/` — React components
- `hooks/` — React hooks

## Coding conventions

- Styles use only Tailwind v4 atomic classes; do not create custom CSS classes (no styles.css).
- Tool definitions follow a three-layer split: `lib/ai/tools/schemas.ts` (zod) → `operations.ts` (pure functions) → `index.ts` (AI SDK `tool` wrapper).
- API responses are wrapped as `{ message, data }`, mirroring the source project's ResponseMiddleware.
- Configuration is read via `.env` + `lib/config.ts`; no yaml.
- Strict typing: validate runtime-unknown data with zod (`safeParse`/`parse`); no unnecessary type assertions, no `@ts-ignore` / `eslint-disable`.
