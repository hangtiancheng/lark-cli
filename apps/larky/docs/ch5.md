---
title: "System Prompt"
description: "System Prompt"
sidebar_position: 4
---

# System Prompt 和权限

## System Prompt

System Prompt 分为 7 个模块

- Agent 的角色
- 行为准则
- 工具调用指南
- 代码质量规范
- 安全边界
- 任务执行模式
- 输出风格

## Prompt 的 7 个来源、3 个字段

### 7 个来源

| 来源                                         | 字段     | 原因                                          |
| -------------------------------------------- | -------- | --------------------------------------------- |
| System Prompt                                | system   | 始终生效, 内容稳定可以缓存                    |
| 环境上下文: 操作系统、工作目录...            | system   | 每个 session 确定后不再改变, 可以缓存         |
| 工具描述: 工具的 description, input_schema   | tools    | LLM API 规范                                  |
| 项目指令文件: AGENTS.md (LARKY.md)           | messages | 内容可能很长, 放在 system 可能稀释 LLM 注意力 |
| 自动记忆: Agent 自动沉淀的用户偏好和项目知识 | messages | 内容可能变化态                                |
| System Reminder: 动态注入的上下文            | messages | 特定时机注入                                  |
| 对话历史                                     | messages | LLM API 规范                                  |

> system 字段的优先级最高, 为什么不都设置为 system 字段?

1. prompt cache, LLM API 支持 prompt cache, 如果 system 字段的值和上一次请求完全相同, 则 LLM API 会复用缓存, 降低 input token 的计费; system prompt 内容稳定, 每次请求都可以命中缓存
   - 稳定的内容放在 system 字段、变化的内容放在 messages 字段
   - AGENTS.md (LARKY.md) 和自动记忆放在 system 字段, 会频繁使得 prompt cache 缓存失效
   - 环境上下文每个 session 不同, 但是一个 session 中是稳定的, 可以使用分层缓存: 全局缓存、会画级缓存
2. system 字段内容太长, 可能会稀释 LLM 注意力
3. 可压缩性: messages 字段的内容, 后续可以被上下文压缩处理; 但是 system 字段的内容不会被压缩, 每次发送 LLM 请求时都会完整携带; 如果 AGENTS.md 的内容后期不再需要, /compact 可以压缩或删除, 但是 system 字段的内容不会被上下文压缩处理, 每次请求都会完整携带

```js
function assembleAPIPayload(config, conversationHistory) {
  // system 字段: 稳定的 system prompt +
  const system = buildSystemPrompt(config);

  // 环境上下文也放到 system 字段, 使用缓存分层管理
  const envContext = buildEnvironmentContext(config);
  system += "\n\n" + envContext;

  const messages = [];

  // 项目指令文件 (AGENTS.md, CLAUDE.md, LARKY.md)
  const instructions = loadInstructionsFiles(config);
  if (instructions) {
    messages.append(systemReminder(instructions));
  }

  // 自动记忆
  const memories = loadMemories(config);
  if (memories) {
    messages.append(systemReminder(memories));
  }
}
```

## 权限

### 三种攻击

- prompt 注入
- 越权
- 数据泄露

### 多层防御

1. 危险命令拦截, 例如 rm -rf /
2. 路径沙箱: 工作目录外的文件操作需要用户确认
   - 计算绝对路径
   - 解析符号链接
   - 检查是否在工作目录内
3. 权限规则
4. 权限模式
   - plan 读放行, 写确认, 通过 prompt 约束 LLM 行为, 使得 LLM 只读
   - default 读放行, 写确认
   - acceptEdits 读写放行, Bash 命令需要确认
   - bypassPermissions 绕过权限, 但是仍然拦截 rm -rf / 等危险命令
5. HITL (Human-in-the-Loop): 人在回路, 用户确认

```jsonl
// 权限规则 (json)
{
  "permissions": {
    "allow": ["Bash(pnpm add *)", "Bash(pnpm dev)"]
  }
}

// 权限模式 (json)
{
  "permissions": {
    "defaultMode": "auto"
  },
}
```

- 本地规则 .larky/permissions.local.yaml
- 项目规则 .larky/permission.yaml
- 全局规则 ~/.larky/permission.yaml

```yaml
# 权限规则 (yaml)
- rule: Bash(git *)
  effect: allow

- rule: Bash(git push --force*)
  effect: deny

- rule: ReadFile(/path/to/project/src/*)
  effect: allow

- rule: ReadFile(*.env*)
  effect: deny

- rule: EditFile(*.ts)
  effect: allow
```

```js
function evaluateRules(toolName, content) {
  for (const ruleSet of [localRules, projectRules, userRoles]) {
    for (const rule of ruleSet) {
      if (rule.match(toolName, pattern) && rule.effect === "DENY") {
        return "DENY";
      }
    }
  }

  // 从高优先级到低优先级查找 allow
  for (const ruleSet of [localRules, projectRules, userRoles]) {
    for (const rule of ruleSet.reverse()) {
      if (rule.match(toolName, pattern) && rule.effect === "ALLOW") {
        return "ALLOW";
      }
    }
  }

  return "UNKNOWN";
}
```
