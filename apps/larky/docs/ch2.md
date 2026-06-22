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

- 请求的 messages: 每条 message 有 role 和 content 两个字段, role (API 请求场景下) 只有两个值: user 和 assistant; messages 数组中, 最好保持 user 和 assistant 两个角色交替出现; 如果连续传递两条 user 消息, API 不会报错, 会自动合并为一条 user 消息
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
