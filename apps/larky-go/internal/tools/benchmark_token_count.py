#!/usr/bin/env python3
"""
延迟加载 Token 节省 Benchmark
用真实 API 的 usage.prompt_tokens 对比全量加载 vs 延迟加载的 token 消耗。
"""
import json
import requests

API_KEY = "sk-cp-bXCpwMoadJIRVIjlNZHOsyJ0fsFwOjiYuurYGk-WnCdd1IjSK_ZPCExpxf2B_sZD6TVn4LKlyIWIjHIG07miHHPprzyeHJhKepQf-HaSTMaFIli2tKDfmYA"
BASE_URL = "https://api.minimaxi.com/v1"
MODEL = "MiniMax-M3"

# --- 构造工具 schema ---

BUILTIN_TOOLS = [
    {"type": "function", "function": {"name": "ReadFile", "description": "Read a file from the local filesystem.", "parameters": {"type": "object", "required": ["file_path"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to read"}, "offset": {"type": "integer", "description": "Line number to start reading from"}, "limit": {"type": "integer", "description": "Number of lines to read"}}}}},
    {"type": "function", "function": {"name": "WriteFile", "description": "Write content to a file, creating it if needed or overwriting existing content.", "parameters": {"type": "object", "required": ["file_path", "content"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to write"}, "content": {"type": "string", "description": "The content to write to the file"}}}}},
    {"type": "function", "function": {"name": "EditFile", "description": "Make targeted edits to a file by replacing specific text with new text.", "parameters": {"type": "object", "required": ["file_path", "old_string", "new_string"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to modify"}, "old_string": {"type": "string", "description": "The text to replace"}, "new_string": {"type": "string", "description": "The replacement text"}, "replace_all": {"type": "boolean", "description": "Replace all occurrences"}}}}},
    {"type": "function", "function": {"name": "Bash", "description": "Execute a bash command and return its output.", "parameters": {"type": "object", "required": ["command"], "properties": {"command": {"type": "string", "description": "The command to execute"}, "timeout": {"type": "integer", "description": "Timeout in milliseconds"}}}}},
    {"type": "function", "function": {"name": "Glob", "description": "Find files matching a glob pattern in the project directory.", "parameters": {"type": "object", "required": ["pattern"], "properties": {"pattern": {"type": "string", "description": "Glob pattern to match files"}, "path": {"type": "string", "description": "Base directory to search from"}}}}},
    {"type": "function", "function": {"name": "Grep", "description": "Search file contents using regular expressions.", "parameters": {"type": "object", "required": ["pattern"], "properties": {"pattern": {"type": "string", "description": "Regular expression pattern to search for"}, "path": {"type": "string", "description": "Directory or file to search in"}, "include": {"type": "string", "description": "File pattern to include"}}}}},
]

TOOL_SEARCH = {"type": "function", "function": {"name": "ToolSearch", "description": "Search for and load additional tools that are not immediately available. Some tools are deferred (not loaded by default) to save context space. Use this tool to discover and load them.\n\nQuery forms:\n- \"select:ToolName,AnotherTool\" — fetch exact tools by name\n- \"keyword search\" — keyword search, returns up to max_results matches", "parameters": {"type": "object", "required": ["query"], "properties": {"query": {"type": "string", "description": "Query to find deferred tools. Use \"select:Name1,Name2\" for direct selection, or keywords to search."}, "max_results": {"type": "integer", "description": "Maximum results to return (default: 5)"}}}}}

# 6 种真实 MCP 工具模板，循环生成 58 个
MCP_TEMPLATES = [
    {"name": "mcp__grafana__query_prometheus_{i:03d}", "desc": "Execute a PromQL query against the specified Prometheus datasource and return time-series or instant results. Supports range queries with configurable step and time window.", "params": {"expr": {"type": "string", "description": "PromQL query expression to evaluate against the datasource"}, "datasource": {"type": "string", "description": "Name or UID of the Prometheus datasource to query"}, "start": {"type": "string", "description": "Start of the time range in RFC3339 format or relative (e.g. 'now-1h')"}, "end": {"type": "string", "description": "End of the time range in RFC3339 format or relative (e.g. 'now')"}, "step": {"type": "string", "description": "Query resolution step width in Prometheus duration format (e.g. '15s', '1m')"}, "format": {"type": "string", "description": "Output format for results", "enum": ["table", "timeseries", "json"]}, "max_results": {"type": "integer", "description": "Maximum number of time series to return"}, "legend": {"type": "string", "description": "Legend format template for result series names"}}},
    {"name": "mcp__grafana__search_dashboards_{i:03d}", "desc": "Search for Grafana dashboards by title, tag, or folder. Returns matching dashboards with metadata including UID, title, URL, folder, and tags.", "params": {"query": {"type": "string", "description": "Search query string to match against dashboard titles"}, "tag": {"type": "array", "items": {"type": "string"}, "description": "Filter dashboards by tags (AND logic)"}, "folder": {"type": "string", "description": "Folder title or UID to restrict search scope"}, "starred": {"type": "boolean", "description": "If true, only return starred dashboards"}, "limit": {"type": "integer", "description": "Maximum number of dashboards to return"}, "sort": {"type": "string", "description": "Sort order for results", "enum": ["alpha-asc", "alpha-desc", "created-asc", "created-desc"]}}},
    {"name": "mcp__playwright__browser_click_{i:03d}", "desc": "Click an element on the page identified by a CSS selector or accessible role. Supports options for button type, click count, position offset, force click, and timeout.", "params": {"selector": {"type": "string", "description": "CSS selector, XPath, or text selector to identify the target element"}, "button": {"type": "string", "description": "Mouse button to click", "enum": ["left", "right", "middle"]}, "clickCount": {"type": "integer", "description": "Number of clicks (1 for single, 2 for double)"}, "force": {"type": "boolean", "description": "Whether to bypass actionability checks and force the click"}, "timeout": {"type": "integer", "description": "Maximum time in milliseconds to wait for the element"}, "position": {"type": "object", "description": "Offset position relative to element's top-left corner", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}}, "modifiers": {"type": "array", "items": {"type": "string", "enum": ["Alt", "Control", "Meta", "Shift"]}, "description": "Keyboard modifiers to press during click"}}},
    {"name": "mcp__grafana__query_loki_{i:03d}", "desc": "Run a LogQL query against a Loki datasource and return matching log lines or metric results. Supports log queries, metric queries, and pattern-based aggregation.", "params": {"query": {"type": "string", "description": "LogQL query expression to execute"}, "datasource": {"type": "string", "description": "Name or UID of the Loki datasource"}, "start": {"type": "string", "description": "Start timestamp in RFC3339 or relative format"}, "end": {"type": "string", "description": "End timestamp in RFC3339 or relative format"}, "limit": {"type": "integer", "description": "Maximum number of log entries to return"}, "direction": {"type": "string", "description": "Log ordering direction", "enum": ["forward", "backward"]}, "step": {"type": "string", "description": "Step interval for metric queries"}, "dedup": {"type": "boolean", "description": "Whether to deduplicate log lines with same content"}}},
    {"name": "mcp__playwright__browser_fill_{i:03d}", "desc": "Fill an input field with text. Clears existing content before typing. Works with input, textarea, and contenteditable elements. Dispatches input and change events.", "params": {"selector": {"type": "string", "description": "CSS selector or text selector for the input element to fill"}, "value": {"type": "string", "description": "Text value to fill into the input field"}, "force": {"type": "boolean", "description": "Whether to bypass actionability checks"}, "timeout": {"type": "integer", "description": "Maximum time in milliseconds to wait for element"}, "noWaitAfter": {"type": "boolean", "description": "If true, do not wait for navigation events after filling"}}},
    {"name": "mcp__grafana__create_annotation_{i:03d}", "desc": "Create an annotation on a Grafana dashboard panel or at the global level. Annotations mark important events on time-series graphs with optional tags and rich text descriptions.", "params": {"dashboardUID": {"type": "string", "description": "UID of the dashboard to annotate (omit for global annotation)"}, "panelId": {"type": "integer", "description": "Panel ID within the dashboard to annotate"}, "time": {"type": "integer", "description": "Unix timestamp in milliseconds for annotation start"}, "timeEnd": {"type": "integer", "description": "Unix timestamp in milliseconds for annotation end (for range annotations)"}, "text": {"type": "string", "description": "Annotation description text, supports basic HTML formatting"}, "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to associate with the annotation for filtering"}}},
]

def make_mcp_tool(template, i):
    return {"type": "function", "function": {
        "name": template["name"].format(i=i),
        "description": template["desc"],
        "parameters": {"type": "object", "required": ["query", "datasource"], "properties": template["params"]},
    }}

def make_all_mcp_tools(n=58):
    return [make_mcp_tool(MCP_TEMPLATES[i % len(MCP_TEMPLATES)], i) for i in range(n)]

def make_deferred_reminder(tool_names):
    return ("The following deferred tools are available via ToolSearch. "
            "Their schemas are NOT loaded - use ToolSearch with query "
            "\"select:<name>[,<name>...]\" to load tool schemas before calling them:\n"
            + "\n".join(tool_names))

def call_api(messages, tools, system=None):
    """调 API 拿 prompt_tokens"""
    body = {"model": MODEL, "messages": messages, "tools": tools, "max_tokens": 1}
    if system:
        body["messages"] = [{"role": "system", "content": system}] + body["messages"]
    resp = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    data = resp.json()
    if "usage" not in data:
        print(f"ERROR: {json.dumps(data, indent=2)}")
        return None
    return data["usage"]

def main():
    mcp_tools = make_all_mcp_tools(58)
    mcp_names = [t["function"]["name"] for t in mcp_tools]

    user_msg = [{"role": "user", "content": "帮我查一下 Grafana 里最近一小时 CPU 使用率超过 80% 的服务。"}]

    print("=" * 70)
    print("延迟加载 Token 节省 Benchmark（真实 API token 计数）")
    print(f"模型: {MODEL} | 内置工具: 6 | MCP工具: 58")
    print("=" * 70)

    # --- 场景 1: 全量加载（64 个工具全部传入）---
    tools_full = BUILTIN_TOOLS + mcp_tools
    print(f"\n[场景1] 全量加载: {len(tools_full)} 个工具全部放入 tools 参数")
    usage_full = call_api(user_msg, tools_full)
    if not usage_full:
        return
    tokens_full = usage_full["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_full}")

    # --- 场景 2: 延迟加载（7 个工具 + system-reminder 列名）---
    tools_deferred = BUILTIN_TOOLS + [TOOL_SEARCH]
    reminder = make_deferred_reminder(mcp_names)
    print(f"\n[场景2] 延迟加载: {len(tools_deferred)} 个工具 + system-reminder 列出 58 个延迟工具名")
    usage_deferred = call_api(user_msg, tools_deferred, system=reminder)
    if not usage_deferred:
        return
    tokens_deferred = usage_deferred["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_deferred}")

    # --- 场景 3: 延迟加载 + 已激活 2 个工具 ---
    activated = mcp_tools[5:6] + mcp_tools[20:21]
    activated_names = [t["function"]["name"] for t in activated]
    remaining_names = [n for n in mcp_names if n not in activated_names]
    tools_partial = BUILTIN_TOOLS + [TOOL_SEARCH] + activated
    reminder_partial = make_deferred_reminder(remaining_names)
    print(f"\n[场景3] 延迟加载 + 2个已激活: {len(tools_partial)} 个工具 + system-reminder 列出 56 个延迟工具名")
    usage_partial = call_api(user_msg, tools_partial, system=reminder_partial)
    if not usage_partial:
        return
    tokens_partial = usage_partial["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_partial}")

    # --- 全会话对比（10 轮）---
    # 全量: 每轮都是 tokens_full
    # 延迟: 前2轮 tokens_deferred, 第3-5轮 tokens_partial, 第6-10轮 tokens_partial
    # 简化: 2轮未激活 + 2轮激活1个(近似用partial) + 6轮激活2个
    total_full = tokens_full * 10
    total_deferred = tokens_deferred * 2 + tokens_partial * 8  # 第3轮起激活工具

    savings = 1 - total_deferred / total_full
    print(f"\n{'=' * 70}")
    print(f"全会话统计（10 轮对话）")
    print(f"{'=' * 70}")
    print(f"  全量加载:   {tokens_full:>8} tokens/轮 × 10 = {total_full:>8} tokens")
    print(f"  延迟加载:   {tokens_deferred:>8} tokens × 2 + {tokens_partial:>8} tokens × 8 = {total_deferred:>8} tokens")
    print(f"  节省:       {savings*100:.1f}% ({total_full - total_deferred} tokens saved)")
    print(f"\n单轮对比:")
    print(f"  全量 vs 未激活:   {tokens_full} vs {tokens_deferred}  (节省 {(1-tokens_deferred/tokens_full)*100:.1f}%)")
    print(f"  全量 vs 激活2个:  {tokens_full} vs {tokens_partial}  (节省 {(1-tokens_partial/tokens_full)*100:.1f}%)")

if __name__ == "__main__":
    main()
