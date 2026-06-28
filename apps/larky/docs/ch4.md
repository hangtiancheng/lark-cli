# ReAct 和 Agent Loop

ReAct (Reasoning + Acting)

- Thinking 解释为什么要做这一步 (text)
- Act 选择调用一个工具 (tool_use)
- Observe (tool_result) 分析工具调用结果, 决定下一步怎么做

## ReAct 对比其他范式

- Chain-of-Thought 只推理, 不行动
- Act-only 只行动, 不推理
- ReAct 推理与行动交替
- Plan-then-execute 先生成完整计划, 再逐步执行

## Agent Loop

```js
function agentLoop(userMessage) {
  const messages = [...historyMessages, userMessage];
  while (true) {
    const response = streamLLM(systemPrompt, messages, toolSchemas);
    const toolUses = response.getToolUses();
    if (toolUses.length === 0) {
      return response;
    }
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const tu of toolUses) {
      const result = executeTool(tu);
      results.push(result);
    }
    messages.push({ role: "user", content: results });
  }
}
```

