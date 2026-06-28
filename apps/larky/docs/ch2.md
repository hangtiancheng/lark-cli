---
title: "LLM API、对话管理"
description: "LLM API、对话管理"
sidebar_position: 2
---

# LLM API、对话管理

请求 Demo

```bash
# Anthropic
curl https://api.anthropic.com/v1/messages \
  -H 'Content-Type: application/json'      \
  -H 'anthropic-version: 2023-06-01'       \
  -H "X-Api-Key: $ANTHROPIC_API_KEY"       \
  -d '{
    "max_tokens": 1024,
    "model": "claude-sonnet-4-6",
    "messages": [
      {
        "role": "user",
        "content": "Hello claude."
      }
    ]
  }'
```

响应 Demo

```json
{
  "id": "msg_abcdefghijklmn0123456789",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I assist you today?"
    }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 12
  }
}
```

- 请求的 messages: 每条 message 有 role 和 content 两个字段, role (API 请求场景下) 只有两个值: user 和 assistant; messages 数组中, 最好保持 user 和 assistant 两个 role 交替出现; 如果连续传递两条 user 消息, API 不会报错, 会自动合并为一条 user 消息
- LLM 返回一个工具调用 (tool_use) 请求, 这是 assistant 消息; 用户调用工具拿到结果, 该工具调用结果需要作为 user 消息发送; 如果错误的将工具调用结果作为 assistant 消息发送, 则会导致连续两条 assistant 消息, API 会直接报错
- 响应的 content 字段是一个数组: LLM 的响应可能包含多种内容, 每种内容是一个独立的 content block, 类型可能是 text、tool_use 等
- 流式响应基于 SSE (Server-Sent Events), 本质是 HTTP 长连接

Claude 的流式事件有固定顺序

```txt
message_start 整个响应开始, 携带 input_tokens 输入 token 数
  content_block_start 一个内容块开始 (text 文本或 tool_use 工具调用), 一个响应可能有多个 content_block 内容块
    content_block_delta 内容块的内容增量, 一个词一个词的到达, 每到达一个词, 可以将内容增量提交给 UI 渲染
  content_block_end 一个内容块结束
message_delta 消息增量 (output_tokens 输出 token 数, stop_reason 停止原因)
message_end 整个响应结束
```

## 请求的 system, messages, tools

- system 参数存放用户信息和环境信息, 包括: 你是谁、操作系统是什么、工作目录是什么
- messages 参数存放对话历史、上下文窗口
- tools 参数存放工具描述

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "system": "You are Larky, a terminal AI programming assistant.\n\n# Environment\nOperating System: MacOS\nWorking Directory: /path/to/cwd\nCurrent Time: 2026-06-22",
  "messages": [
    { "role": "user", "content": "Explain the contents of ./app.ts." },
    {
      "role": "assistant",
      "content": "Sure, let me read the contents of ./app.ts.\nfunction main() {\n  console.log(\"javascript newbie\")\n}"
    },
    { "role": "user", "content": "What functions are in this file?" }
  ],
  "tools": [
    {
      "name": "read_file",
      "description": "Read the text content of a file. Path must be relative to the current working directory. Files larger than 512 KB are truncated.",
      "input_schema": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Relative path to the file (relative to current working directory)."
          }
        },
        "required": ["path"]
      }
    }
  ]
}
```

## token

token 是 LLM 的计费单位, 每个英文单词大约 1-2 个 token, 每个汉字大约 1-2 个 token, 具体取决于 LLM 使用的 tokenizer

Claude API 的计费分为

- input_tokens: 发送给 LLM 的内容, 包括 system_prompt, messages 和 tools 描述
- output_tokens: LLM 生成的内容, 输出 token 比输入 token 贵的多

### 历史越长、输入越贵

每轮请求, 都需要发送完整的对话历史; 如果和 LLM 聊了 20 轮, 第 21 轮请求会包含前 20 轮的所有消息; input_tokens 会随着对话轮次线形增长, 所以需要上下文压缩

## Extend Thinking 推理

Claude 支持 Extended Thinking, 让 LLM 回复前先进行内部推理, 开启后响应的 content 数组中会多一个 `type: thinking` 的内容块, 排在 text 内容块的前面; thinking 的 token 计算到 output_tokens 中;

包含工具调用的一轮对话, 对话历史中的 thinking 内容块必须携带, 和后面的 tool_result 一起发送给 LLM API, 否则会报错; 对于纯聊天、没有工具调用的场景, 则对话历史中的 thinking 内容块可以不携带, LLM API 会自动忽略

## 如何封装

只需要 4 个字段就能覆盖主流厂商: Anthropic、OpenAI、...

- protocol: LLM API 协议, 例如 anthropic、openai、openai-compat、...
- model: LLM 模型, 例如 claude-haiku-4-6、claude-sonnet-4-6、claude-opus-4-6、...
- base_url: 端点地址
- api_key: 令牌

封装层负责翻译

## 多轮对话如何实现

每一轮 LLM API 请求, 都包含完整的对话历史, 需要在客户端维护完整的消息列表, 每次用户 (CLI) 发送请求、LLM 响应, 都需要记录, token 消耗会随着对话轮次线形增长

### 消息模型

API 层

- role: user, assistant, system
- content: 消息内容 (thinking 推理、text 文本、tool_use 工具调用或其他格式)

内部层

- ID: `msg_<hash>` 可以根据消息 ID 定位到正在接收的 assistant 消息, 并追加 SSE chunk
- status: streaming, complete, error 封装层翻译时可以过滤 error 状态的消息
- timestamp
- usage: `{ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }`
- role: user, assistant, system, tool (Only for OpenAI)
- content: 消息内容 (thinking 推理、text 文本、tool_use 工具调用或其他格式)

### 对话管理器

考虑到流式接收, CLI 正在向 assistant 消息 (SSE chunk 数组) 中追加 SSE chunk, 同时 TUI 正在读 assistant 消息 (SSE chunk 数组) 以渲染 TUI, 两处同时操作同一个列表, 可能导致数据竞争

- Node.js 单线程异步, 避免数据竞争
- Go 加锁

追加 SSE chunk 时, 拿到 assistant 消息的唯一 ID, 根据 ID 追加 SSE chunk; 更新 TUI 时, 根据 ID 拿到一份 assistant 消息的快照

## 格式转换: 内部消息到 LLM API 消息

- [Anthropic](apps/larky/src/llm/anthropic.ts)
- [OpenAI](apps/larky/src/llm/openai.ts)

1. 过滤: system 消息 (例如欢迎语)、error 状态的 assistant 消息需要过滤
2. 合并: 虽然 Claude API 可以自动合并相邻的相同 role 的消息, 但是在客户端合并是更好的做法, 消息结构更清晰, 减少 token 消耗
3. 过滤掉 system 消息后, 第一条消息的 role 必须是 user, 并且 message 数组中 user 和 assistant 两个 role 交替出现

## 先占位, 再填充

用户发送请求后, 对话管理器先创建一条空的 assistant 消息作为占位符, 将状态标记为 streaming 正在流式输出; 一边接收 SSE chunk, 一边向该 assistant 消息中追加 SSE chunk; 等到流式输出接收, 将状态标记为 complete 完成, 记录 token 用量

## 代码

- [anthropic.ts](apps/larky/src/llm/anthropic.ts)
- [client.ts](apps/larky/src/llm/client.ts)
- [errors.ts](apps/larky/src/llm/errors.ts)
- [events.ts](apps/larky/src/llm/events.ts)
- [model-resolver.ts](apps/larky/src/llm/model-resolver.ts)
- [conversation.ts](apps/larky/src/conversation/conversation.ts)
