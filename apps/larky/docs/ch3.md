---
title: "Function Calling (Tool Use)"
description: "Function Calling (Tool Use)"
sidebar_position: 3
---

# Function Calling (Tool Use)

## 告诉 LLM 有哪些工具

调用 LLM API 时, 可以通过 tools 参数告诉 LLM 有哪些工具, 包括名称 name, 描述 description, 参数格式 tool schema

```json
{
  "tools": [
    {
      "name": "ReadFile",
      "description": "Read the text content of a file, path must be absolute.",
      "input_schema": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Absolute path to the file."
          }
        }
      },
      "required": ["path"]
    }
  ]
}
```

## LLM 决定调用工具

LLM 决定调用工具时, LLM API 的响应中包含一个结构化的工具调用请求

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Let me read the text content of this file."
    },
    {
      "type": "tool_use",
      "id": "toolu_123abc",
      "name": "ReadFile",
      "input": {
        "path": "src/main.go"
      }
    }
  ]
}
```

- 一个 LLM API 的响应中, 可以既包含文本内容块, 又包含工具调用请求内容块, 甚至同时请求调用多个工具
- 每个 tool_use 工具调用请求, 都有一个唯一 ID

## CLI 执行工具调用, 返回工具调用结果给 LLM API

- CLI 收到 tool_use 工具调用请求后, CLI 执行工具调用相关代码, 将工具调用结果返回给 LLM API

```json
{
  // 用户执行工具调用, role 是 user
  "role": "user",
  "content": {
    "type": "tool_result",
    // 必须和 tool_use 工具调用请求的 ID 相同
    "tool_use_id": "toolu_123abc",
    "content": "1\tfunction main() {\n2\t  console.log(\"javascript newbie\")\n3\t}"
  }
}
```

## LLM 继续

LLM 收到工具调用结果, 继续...

LLM 负责决策, 请求调用工具; CLI 负责执行工具调用, 将工具调用结果返回给 LLM API

- LLM 决定是否调用某个工具时, 主要参考工具描述 (description), 工具描述的质量直接决定 LLM 的工具调用行为, 包括: 什么时候调用工具、调用哪个工具、如何传递参数
- 好的工具描述应该包括: 工具的核心功能、什么时候应该调用、什么时候不应该调用、输入参数的 schema、输出的工具调用结果的 schema、与其他工具的配合 (工作流建议, 例如对于大文件, 先 Grep 定位再 ReadFile 读文件)

## 工具接口设计

- 身份信息: name、description、schema (inputSchema / parameters)
- 元信息: readonly? (只读)、destructive? (破坏性的)、concurrencySafe? (是否可以和其他工具并发执行)、category
- 行为: execute、validateInput?

```ts
export interface ToolResult {
  output: string;
  // 工具执行失败对于 LLM 是有价值的反馈, 引导 LLM 调整策略
  isError: boolean;
}
```

### ReadFile

- properties: file_path, offset, limit
- metadata: 只读、非破坏性、分类 file
- 行号: 读文件需要带行号前缀, 方便定位代码位置 `"1\tfunction main() {\n2\t  console.log(\"javascript newbie\")\n3\t}"`
- 大文件: 支持 offset 和 limit 参数, 指定从第 offset 行开始读、读 limit 行, 使得 LLM 可以分段读文件
- 二进制文件: 通过读文件的前 512 字节, 如果包含 NUL 字符 (\x00), 则判定为二进制文件并拒绝读取, 提示 LLM 使用 bash 工具处理

### WriteFile

- properties: file_path, content
- metadata: 非只读、非破坏性、分类 file
- 创建或重写, 创建时需要递归的创建父目录 (权限 0755)

### EditFile

- properties: file_path, old_string, new_string, replace_all
- metadata: 非只读、非破坏性、分类 file
- 如果 replace_all === false, 则 old_string 必须唯一匹配
  - 如果匹配多个, 报错提示: 该 old_string 匹配 N 个, 请提供更多的上下文使得 old_string 唯一匹配
  - 如果没有找到, 说明 LLM 记忆的文件内容可能过时
- 替换成功后, 返回修改位置附近几行的内容 (带行号前缀), 返回给 LLM 确认修改是否正确
- new_string 为空, 表示删除 old_string

### Bash

- properties: command, timeout
- metadata: 非只读、破坏性、分类 shell
- 工作目录: 项目根目录, 超时: 120s
- 输出: stdout、stderr 合并到一个流; 输出过长时截断, 保留前面的部分和截断标记
- 命令退出码的语义
  - 默认非 0 退出码 isError: true
  - grep 退出码 1 表示: 没有找到匹配, 退出码 >=2 视为 error
  - diff 退出码 1 表示文件有差异, 退出码 >=2 视为 error

### Glob

- properties: pattern, path
- metadata: 只读、非破坏性、分类 search
- glob 查找文件内容
- 搜索结果按修改时间倒序排序, 最新修改的排在前面

### Grep

- properties: pattern, path, include
- metadata: 只读、非破坏性、分类 search
- grep 找文件内容
- 输出格式: 文件路径:行号:匹配的内容

| 工具      | 分类   | 只读 | 破坏性 | 场景           |
| --------- | ------ | ---- | ------ | -------------- |
| ReadFile  | file   | 是   | 否     | 读文件         |
| WriteFile | file   | 否   | 否     | 创建或重写文件 |
| EditFile  | file   | 否   | 否     | 修改文件       |
| Bash      | shell  | 否   | 是     | all            |
| Glob      | search | 是   | 否     | 查找文件名     |
| Grep      | search | 是   | 否     | 查找文件内容   |

## 流式 tool_use 解析: 拼接 partialJson JSON 碎片

```txt
# tool_use 块开始
content_block_start -> type: "tool_use", id: "toolu_123abc", name: "ReadFile"

# 传输 JSON 碎片
content_block_delta -> type: "input_json_delta", partial_json: "{"
content_block_delta -> type: "input_json_delta", partial_json: "\"path\""
content_block_delta -> type: "input_json_delta", partial_json: ": \"/main.js\"}"

# tool_use 块结束
content_block_stop
```

- tool_use 工具调用请求的 role 是 assistant, tool_result 工具调用结果的 role 是 user
- 一条 assistant 消息可能同时包含 text 内容块和 tool_use 内容块, 必须在同一条 assistant 消息中, 不能拆成两条 assistant 消息
- 如果一条 assistant 消息包含多个 tool_use 内容块, 即 LLM 请求同时调用多个工具, 则多个 tool_result 内容块必须在同一条 user 消息中, 通过 id 配对
