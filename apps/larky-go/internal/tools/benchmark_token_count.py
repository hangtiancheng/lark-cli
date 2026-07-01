#!/usr/bin/env python3
"""
Deferred Loading Token Savings Benchmark.
Compares token consumption between full loading and deferred loading
using real API usage.prompt_tokens values.
"""
import json
import requests

API_KEY = "sk-cp-bXCpwMoadJIRVIjlNZHOsyJ0fsFwOjiYuurYGk-WnCdd1IjSK_ZPCExpxf2B_sZD6TVn4LKlyIWIjHIG07miHHPprzyeHJhKepQf-HaSTMaFIli2tKDfmYA"
BASE_URL = "https://api.minimaxi.com/v1"
MODEL = "MiniMax-M3"

# --- Build tool schemas ---

BUILTIN_TOOLS = [
    {"type": "function", "function": {"name": "ReadFile", "description": "Read a file from the local filesystem.", "parameters": {"type": "object", "required": ["file_path"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to read"}, "offset": {"type": "integer", "description": "Line number to start reading from"}, "limit": {"type": "integer", "description": "Number of lines to read"}}}}},
    {"type": "function", "function": {"name": "WriteFile", "description": "Write content to a file, creating it if needed or overwriting existing content.", "parameters": {"type": "object", "required": ["file_path", "content"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to write"}, "content": {"type": "string", "description": "The content to write to the file"}}}}},
    {"type": "function", "function": {"name": "EditFile", "description": "Make targeted edits to a file by replacing specific text with new text.", "parameters": {"type": "object", "required": ["file_path", "old_string", "new_string"], "properties": {"file_path": {"type": "string", "description": "The absolute path to the file to modify"}, "old_string": {"type": "string", "description": "The text to replace"}, "new_string": {"type": "string", "description": "The replacement text"}, "replace_all": {"type": "boolean", "description": "Replace all occurrences"}}}}},
    {"type": "function", "function": {"name": "Bash", "description": "Execute a bash command and return its output.", "parameters": {"type": "object", "required": ["command"], "properties": {"command": {"type": "string", "description": "The command to execute"}, "timeout": {"type": "integer", "description": "Timeout in milliseconds"}}}}},
    {"type": "function", "function": {"name": "Glob", "description": "Find files matching a glob pattern in the project directory.", "parameters": {"type": "object", "required": ["pattern"], "properties": {"pattern": {"type": "string", "description": "Glob pattern to match files"}, "path": {"type": "string", "description": "Base directory to search from"}}}}},
    {"type": "function", "function": {"name": "Grep", "description": "Search file contents using regular expressions.", "parameters": {"type": "object", "required": ["pattern"], "properties": {"pattern": {"type": "string", "description": "Regular expression pattern to search for"}, "path": {"type": "string", "description": "Directory or file to search in"}, "include": {"type": "string", "description": "File pattern to include"}}}}},
]

TOOL_SEARCH = {"type": "function", "function": {"name": "ToolSearch", "description": "Search for and load additional tools that are not immediately available. Some tools are deferred (not loaded by default) to save context space. Use this tool to discover and load them.\n\nQuery forms:\n- \"select:ToolName,AnotherTool\" — fetch exact tools by name\n- \"keyword search\" — keyword search, returns up to max_results matches", "parameters": {"type": "object", "required": ["query"], "properties": {"query": {"type": "string", "description": "Query to find deferred tools. Use \"select:Name1,Name2\" for direct selection, or keywords to search."}, "max_results": {"type": "integer", "description": "Maximum results to return (default: 5)"}}}}}

# 6 real MCP tool templates, cycled to generate 58 tools.
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
    """Call the API and retrieve prompt_tokens."""
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

    user_msg = [{"role": "user", "content": "Check which services in Grafana have had CPU usage above 80% in the last hour."}]

    print("=" * 70)
    print("Deferred Loading Token Savings Benchmark (Real API token counts)")
    print(f"Model: {MODEL} | Built-in tools: 6 | MCP tools: 58")
    print("=" * 70)

    # --- Scenario 1: Full loading (all 64 tools passed in) ---
    tools_full = BUILTIN_TOOLS + mcp_tools
    print(f"\n[Scenario 1] Full loading: all {len(tools_full)} tools passed to the tools parameter")
    usage_full = call_api(user_msg, tools_full)
    if not usage_full:
        return
    tokens_full = usage_full["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_full}")

    # --- Scenario 2: Deferred loading (7 tools + system-reminder listing names) ---
    tools_deferred = BUILTIN_TOOLS + [TOOL_SEARCH]
    reminder = make_deferred_reminder(mcp_names)
    print(f"\n[Scenario 2] Deferred loading: {len(tools_deferred)} tools + system-reminder listing 58 deferred tool names")
    usage_deferred = call_api(user_msg, tools_deferred, system=reminder)
    if not usage_deferred:
        return
    tokens_deferred = usage_deferred["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_deferred}")

    # --- Scenario 3: Deferred loading + 2 tools already activated ---
    activated = mcp_tools[5:6] + mcp_tools[20:21]
    activated_names = [t["function"]["name"] for t in activated]
    remaining_names = [n for n in mcp_names if n not in activated_names]
    tools_partial = BUILTIN_TOOLS + [TOOL_SEARCH] + activated
    reminder_partial = make_deferred_reminder(remaining_names)
    print(f"\n[Scenario 3] Deferred loading + 2 activated: {len(tools_partial)} tools + system-reminder listing 56 deferred tool names")
    usage_partial = call_api(user_msg, tools_partial, system=reminder_partial)
    if not usage_partial:
        return
    tokens_partial = usage_partial["prompt_tokens"]
    print(f"  prompt_tokens = {tokens_partial}")

    # --- Full session comparison (10 turns) ---
    # Full loading: each turn costs tokens_full.
    # Deferred: turns 1-2 cost tokens_deferred, turns 3-5 cost tokens_partial, turns 6-10 cost tokens_partial.
    # Simplified: 2 turns unactivated + 2 turns with 1 activated (approximated as partial) + 6 turns with 2 activated.
    total_full = tokens_full * 10
    total_deferred = tokens_deferred * 2 + tokens_partial * 8  # tools activated starting from turn 3

    savings = 1 - total_deferred / total_full
    print(f"\n{'=' * 70}")
    print(f"Full Session Statistics (10 turns)")
    print(f"{'=' * 70}")
    print(f"  Full loading:     {tokens_full:>8} tokens/turn x 10 = {total_full:>8} tokens")
    print(f"  Deferred loading: {tokens_deferred:>8} tokens x 2 + {tokens_partial:>8} tokens x 8 = {total_deferred:>8} tokens")
    print(f"  Savings:          {savings*100:.1f}% ({total_full - total_deferred} tokens saved)")
    print(f"\nPer-turn comparison:")
    print(f"  Full vs unactivated:    {tokens_full} vs {tokens_deferred}  (savings {(1-tokens_deferred/tokens_full)*100:.1f}%)")
    print(f"  Full vs 2 activated:    {tokens_full} vs {tokens_partial}  (savings {(1-tokens_partial/tokens_full)*100:.1f}%)")

if __name__ == "__main__":
    main()
