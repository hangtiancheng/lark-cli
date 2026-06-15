package bus_test

import (
	"encoding/json"
	"testing"

	"github.com/hangtiancheng/lark-cli/apps/lark-code-go/internal/bus"
)

func TestEventMarshalUnmarshal(t *testing.T) {
	events := []bus.Event{
		&bus.RunStartedEvent{Type: "run.started", RunID: "run-123", Goal: "test goal", TS: "2024-01-01T00:00:00Z"},
		&bus.RunFinishedEvent{Type: "run.finished", RunID: "run-123", Status: "success", Steps: 3, TS: "2024-01-01T00:00:01Z"},
		&bus.ToolCallStartedEvent{Type: "tool.call_started", RunID: "run-123", ToolUseID: "tool-use-1", ToolName: "bash", Params: map[string]any{"command": "echo hello"}, TS: "2024-01-01T00:00:00Z"},
		&bus.LlmTokenEvent{Type: "llm.token", RunID: "run-123", Token: "Hello", TS: "2024-01-01T00:00:00Z"},
		&bus.SessionCreatedEvent{Type: "session.created", SessionID: "session-abc", Mode: "chat", TS: "2024-01-01T00:00:00Z"},
		&bus.PermissionRequestedEvent{Type: "permission.requested", RunID: "run-123", ToolUseID: "tool-use-1", ToolName: "bash", Params: map[string]any{}, ParamPreview: "command: ls", SessionID: "session-abc", TS: "2024-01-01T00:00:00Z"},
		&bus.SubagentStartedEvent{Type: "subagent.started", RunID: "run-child", ParentRunID: "run-123", Description: "do work", TS: "2024-01-01T00:00:00Z"},
		&bus.ContextCompactedEvent{Type: "context.compacted", SessionID: "session-abc", RunID: "run-123", OriginalTokens: 1000, SummaryTokens: 200, TS: "2024-01-01T00:00:00Z"},
		&bus.SkillInvokedEvent{Type: "skill.invoked", SkillName: "review", Arguments: "check code", RunID: "run-123", TS: "2024-01-01T00:00:00Z"},
	}

	for _, evt := range events {
		t.Run(evt.EventType(), func(t *testing.T) {
			data, err := bus.MarshalEvent(evt)
			if err != nil {
				t.Fatalf("MarshalEvent failed: %v", err)
			}

			// Verify type field is present
			var probe struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(data, &probe); err != nil {
				t.Fatalf("probe unmarshal failed: %v", err)
			}
			if probe.Type != evt.EventType() {
				t.Errorf("expected type %q, got %q", evt.EventType(), probe.Type)
			}

			// Unmarshal back
			restored, err := bus.UnmarshalEvent(data)
			if err != nil {
				t.Fatalf("UnmarshalEvent failed: %v", err)
			}
			if restored.EventType() != evt.EventType() {
				t.Errorf("expected type %q, got %q", evt.EventType(), restored.EventType())
			}
		})
	}
}

func TestUnmarshalUnknownEvent(t *testing.T) {
	data := []byte(`{"type":"unknown.event","foo":"bar"}`)
	_, err := bus.UnmarshalEvent(data)
	if err == nil {
		t.Error("expected error for unknown event type")
	}
}

func TestMakeSuccess(t *testing.T) {
	resp := bus.MakeSuccess("req-1", map[string]any{"ok": true})
	if resp.Jsonrpc != "2.0" {
		t.Errorf("expected jsonrpc 2.0, got %s", resp.Jsonrpc)
	}
	if resp.ID != "req-1" {
		t.Errorf("expected id req-1, got %s", resp.ID)
	}
}

func TestMakeError(t *testing.T) {
	resp := bus.MakeError("req-1", bus.MethodNotFound, "not found", nil)
	if resp.Error.Code != bus.MethodNotFound {
		t.Errorf("expected code %d, got %d", bus.MethodNotFound, resp.Error.Code)
	}
	if resp.Error.Message != "not found" {
		t.Errorf("expected message 'not found', got %s", resp.Error.Message)
	}
}

func TestCommandUnmarshal(t *testing.T) {
	tests := []struct {
		method string
		params string
	}{
		{"core.ping", `{"client":"test"}`},
		{"session.create", `{"mode":"chat","title":"test"}`},
		{"session.send_message", `{"session_id":"session-1","content":"hello"}`},
		{"permission.respond", `{"tool_use_id":"tool-use-1","decision":"allow_once"}`},
	}

	for _, tc := range tests {
		t.Run(tc.method, func(t *testing.T) {
			cmd, err := bus.UnmarshalCommand(tc.method, json.RawMessage(tc.params))
			if err != nil {
				t.Fatalf("UnmarshalCommand failed: %v", err)
			}
			if cmd == nil {
				t.Error("expected non-nil command")
			}
		})
	}
}

func TestUnmarshalUnknownCommand(t *testing.T) {
	_, err := bus.UnmarshalCommand("unknown.method", nil)
	if err == nil {
		t.Error("expected error for unknown command")
	}
}
