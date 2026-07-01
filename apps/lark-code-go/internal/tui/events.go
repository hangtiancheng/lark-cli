package tui

import (
	"fmt"
	"strings"
	"time"
)

// handleEvent routes a daemon event to its rendering handler. This mirrors
// Python's _handle_event_inner, covering all 24 event types.
func (m *Model) handleEvent(eventType string, data map[string]any) {
	// LLM token streaming is handled specially: tokens accumulate into the
	// current stream block without breaking it.
	if eventType == "llm.token" {
		token, _ := data["token"].(string)
		if m.currentLLM == nil {
			m.currentLLM = NewStreamBlock()
			m.append(m.currentLLM)
		}
		m.currentLLM.AppendToken(token)
		return
	}

	// Any other event breaks (finalizes) the current LLM stream block.
	m.breakLLM()

	switch eventType {
	case "session.waiting_for_input":
		m.busy = false
		m.status = statusReady
		m.input.SetEnabled(true)
		m.input.SetBorderTitle("type a message")

	case "session.closed":
		m.busy = false
		m.status = statusDisconnected
		m.input.SetEnabled(false)
		m.input.SetBorderTitle("session closed")

	case "run.started":
		runID, _ := data["run_id"].(string)
		goal, _ := data["goal"].(string)
		m.append(staticLine(dimStyle.Render("run") +
			"  " + accentStyle.Render(runID) +
			"  " + dimStyle.Render(truncate(goal, 96))))

	case "run.finished":
		status, _ := data["status"].(string)
		steps := intVal(data["steps"])
		reason, _ := data["reason"].(string)
		if status == "success" {
			m.append(staticLine(runOKStyle.Render(fmt.Sprintf("✓ completed  %d steps", steps))))
		} else {
			detail := ""
			if reason != "" {
				detail = "  " + dimStyle.Render(reason)
			}
			m.append(staticLine(runErrStyle.Render(fmt.Sprintf("✗ failed%s  %d steps", detail, steps))))
		}

	case "step.started":
		runID, _ := data["run_id"].(string)
		// Skip step lines for subagent runs (they're shown via subagent events).
		if _, isSub := m.subagentRunIDs[runID]; isSub {
			return
		}
		step := intVal(data["step"])
		m.append(staticLine(stepDividerStyle.Render(fmt.Sprintf("step %d", step))))

	case "tool.call_started":
		toolUseID, _ := data["tool_use_id"].(string)
		toolName, _ := data["tool_name"].(string)
		params, _ := data["params"].(map[string]any)
		runID, _ := data["run_id"].(string)
		tb := NewToolBlock(toolName, params)
		if _, isSub := m.subagentRunIDs[runID]; isSub {
			tb.SetIndent("    ")
		}
		m.pendingTools[toolUseID] = tb
		m.append(tb)

	case "tool.call_finished":
		toolUseID, _ := data["tool_use_id"].(string)
		elapsedMs := intVal(data["elapsed_ms"])
		output, _ := data["output"].(string)
		if tb, ok := m.pendingTools[toolUseID]; ok {
			tb.SetResult(output, elapsedMs, false)
			delete(m.pendingTools, toolUseID)
		}

	case "tool.call_failed":
		toolUseID, _ := data["tool_use_id"].(string)
		elapsedMs := intVal(data["elapsed_ms"])
		errMsg, _ := data["error_message"].(string)
		if tb, ok := m.pendingTools[toolUseID]; ok {
			tb.SetResult(errMsg, elapsedMs, true)
			delete(m.pendingTools, toolUseID)
		}

	case "llm.usage":
		runID, _ := data["run_id"].(string)
		if _, isSub := m.subagentRunIDs[runID]; isSub {
			return
		}
		inputTokens := intVal(data["input_tokens"])
		outputTokens := intVal(data["output_tokens"])
		cacheRead := intVal(data["cache_read_input_tokens"])
		contextPct, _ := data["context_pct"].(float64)
		m.usage = &usageStats{
			inputTokens:  inputTokens,
			outputTokens: outputTokens,
			cacheRead:    cacheRead,
			contextPct:   contextPct,
		}
		m.lastContextPct = contextPct
		ctxBar := renderProgressBar(contextPct, 20)
		m.append(staticLine(usageStyle.Render(fmt.Sprintf(
			"  tokens  in=%d out=%d cache=%d  %s %.1f%%",
			inputTokens, outputTokens, cacheRead, ctxBar, contextPct*100))))

	case "context.compacted":
		orig := intVal(data["original_tokens"])
		summary := intVal(data["summary_tokens"])
		m.lastContextPct = 0
		m.append(staticLine(fmt.Sprintf("%s  %s",
			accentStyle.Bold(true).Render("⚡ Context compacted"),
			dimStyle.Render(fmt.Sprintf("original≈%d tokens → summary=%d tokens", orig, summary)))))

	case "permission.requested":
		toolUseID, _ := data["tool_use_id"].(string)
		toolName, _ := data["tool_name"].(string)
		paramPreview, _ := data["param_preview"].(string)
		pb := NewPermissionBlock(toolUseID, toolName, paramPreview)
		m.pendingPerms[toolUseID] = pb
		m.append(pb)
		m.permSelect = NewPermissionSelect(toolUseID)
		m.input.SetEnabled(false)
		m.input.SetBorderTitle("permission required")

	case "permission.granted":
		m.resolvePermission(data, true)

	case "permission.denied":
		m.resolvePermission(data, false)

	case "subagent.started":
		runID, _ := data["run_id"].(string)
		description, _ := data["description"].(string)
		m.subagentRunIDs[runID] = description
		m.subagentStartTimes[runID] = time.Now()
		shortID := runID
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		m.append(staticLine(fmt.Sprintf("%s %s  %s",
			dimStyle.Render("┌─"),
			accentStyle.Render(truncate(description, 72)),
			dimStyle.Render(shortID))))

	case "subagent.finished":
		runID, _ := data["run_id"].(string)
		status, _ := data["status"].(string)
		description := m.subagentRunIDs[runID]
		if description == "" {
			description, _ = data["description"].(string)
		}
		start, hasStart := m.subagentStartTimes[runID]
		elapsed := ""
		if hasStart {
			elapsed = "  " + dimStyle.Render(fmt.Sprintf("%.1fs", time.Since(start).Seconds()))
		}
		delete(m.subagentRunIDs, runID)
		delete(m.subagentStartTimes, runID)
		descPart := accentStyle.Render(truncate(description, 72)) + elapsed
		if status == "success" {
			m.append(staticLine(fmt.Sprintf("%s %s %s",
				dimStyle.Render("└─"),
				successStyle.Bold(true).Render("✓"),
				descPart)))
		} else {
			m.append(staticLine(fmt.Sprintf("%s %s %s",
				dimStyle.Render("└─"),
				errorStyle.Bold(true).Render("✗"),
				descPart)))
		}

	case "skill.invoked":
		skillName, _ := data["skill_name"].(string)
		arguments, _ := data["arguments"].(string)
		argsPart := ""
		if arguments != "" {
			argsPart = "  " + dimStyle.Render(truncate(arguments, 80))
		}
		m.append(staticLine(accentStyle.Bold(true).Render("/"+skillName) + argsPart))

	case "log.line":
		level, _ := data["level"].(string)
		source, _ := data["source"].(string)
		message, _ := data["message"].(string)
		var levelPart string
		switch strings.ToUpper(level) {
		case "ERROR":
			levelPart = errorStyle.Bold(true).Render(level)
		case "WARNING", "WARN":
			levelPart = warningStyle.Render(level)
		default:
			levelPart = dimStyle.Render(level)
		}
		m.append(staticLine(fmt.Sprintf("%s  %s  %s",
			levelPart, dimStyle.Render(source), message)))

	case "session.resumed":
		m.append(staticLine(dimStyle.Render("↻ session resumed")))

	case "session.created":
		// Quietly handled; no log line needed.

	case "session.message_received":
		// The user's message is echoed when submitted, not here.

	case "llm.model_selected":
		// Could show model selection; keep quiet to reduce noise.

	case "core.started", "step.finished":
		// Internal lifecycle events; not rendered in the TUI.

	default:
		// Unknown event types render as a dim line.
		m.append(staticLine(dimStyle.Render(fmt.Sprintf("  %s", eventType))))
	}
}

// resolvePermission handles permission.granted and permission.denied events,
// resolving the corresponding block and clearing the select widget.
func (m *Model) resolvePermission(data map[string]any, granted bool) {
	toolUseID, _ := data["tool_use_id"].(string)
	decision, _ := data["decision"].(string)
	if decision == "" {
		if granted {
			decision = DecisionAllowOnce
		} else {
			decision = DecisionDenyOnce
		}
	}
	if pb, ok := m.pendingPerms[toolUseID]; ok {
		pb.Resolve(decision)
		delete(m.pendingPerms, toolUseID)
	}
	// Clear the select widget if it was for this tool.
	if m.permSelect != nil && m.permSelect.ToolUseID() == toolUseID {
		m.permSelect = nil
	}
	// Re-enable input if no more pending permissions.
	if len(m.pendingPerms) == 0 {
		m.input.SetEnabled(true)
		m.input.SetBorderTitle("type a message")
	}
}

// intVal safely extracts an integer from a map[string]any value, handling
// both float64 (JSON default) and int representations.
func intVal(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}
