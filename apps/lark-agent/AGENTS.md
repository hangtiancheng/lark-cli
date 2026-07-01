<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# lark-agent

由 SuperBizAgent(Go + cloudwego/eino)迁移而来的 AI 智能运维助手,品牌 lark-agent。

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript
- Vercel AI SDK v7(`ai`):streamText / generateText / generateObject / tool / embed / embedMany
- LLM:DeepSeek-v3(火山引擎 ark,OpenAI 兼容)via `@ai-sdk/openai` 的 createOpenAI
- Embedding:阿里百炼 dashscope text-embedding-v4 via `@ai-sdk/openai-compatible`
- 向量库:Milvus(`@zilliz/milvus2-sdk-node`,db=agent,collection=biz,BinaryVector dim 65536)
- MySQL:`knex` + `mysql2`(mysql_crud 工具用 knex.raw 执行动态 SQL)
- MCP:`@modelcontextprotocol/sdk`(SSE 连接日志 MCP)
- 前端:Tailwind v4 内置原子类 + react-markdown + highlight.js

## 目录约定

- `app/` — Next.js App Router(page / layout / api route)
- `lib/` — 服务端逻辑(ai / milvus / memory / config)
- `components/` — React 组件
- `hooks/` — React hooks

## 编码约束

- 样式只用 Tailwind v4 内置原子类,禁止创建自定义 CSS 类(不建 styles.css)
- 工具定义采用三层分离:`lib/ai/tools/schemas.ts`(zod)→ `operations.ts`(纯函数)→ `index.ts`(ai `tool` 包装)
- plan-execute-replan 参考 mewcode 事件流封装(AsyncGenerator<Event>)
- API 统一响应包装 `{ message, data }`,对应源项目 ResponseMiddleware
- 配置通过 `.env` + `lib/config.ts` 读取,不使用 yaml
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
