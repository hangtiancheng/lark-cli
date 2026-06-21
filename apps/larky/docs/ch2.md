# LLM API、对话管理

请求 Demo

```bash
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
