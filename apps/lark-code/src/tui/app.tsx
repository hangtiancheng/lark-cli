// Main TUI application: orchestrates components and event loop
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";

import { Header } from "./components/header.js";
import { StatusBar } from "./components/status-bar.js";
import { EventLog } from "./components/event-log.js";
import { InputBar } from "./components/input-bar.js";
import { PermissionPrompt } from "./components/permission-prompt.js";
import type { AgentEvent } from "./components/event-card.js";
import type { SocketClient } from "../core/transport/socket-client.js";
import type { LarkConfig } from "../core/config.js";
import { version } from "../index.js";

interface AppProps {
  readonly _config: LarkConfig;
  readonly client: SocketClient;
}

export function App({ _config, client }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [runStatus, setRunStatus] = useState<
    "idle" | "running" | "waiting" | "success" | "failed"
  >("idle");
  const [step, setStep] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    paramsPreview: string;
    toolUseId: string;
  } | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Connect to daemon and create a persistent chat session
  useEffect(() => {
    const connect = async () => {
      try {
        await client.connect();
        setConnected(true);

        // Subscribe to all events
        client.onEvent((event) => {
          const agentEvent: AgentEvent = {
            type: typeof event["type"] === "string" ? event["type"] : "unknown",
            data: event,
            timestamp:
              typeof event["timestamp"] === "string"
                ? event["timestamp"]
                : new Date().toISOString(),
          };

          setEvents((prev) => [...prev, agentEvent]);

          // Update state based on event type
          if (event["type"] === "run.started") {
            setRunStatus("running");
            setStep(0);
            setTotalTokens(0);
            setElapsedMs(0);
          } else if (event["type"] === "run.finished") {
            // Don't go to idle yet — wait for session.waiting_for_input
            // in chat mode. For safety, set idle if no session exists.
            if (!sessionIdRef.current) {
              setRunStatus("idle");
            }
          } else if (event["type"] === "step.started") {
            setStep((s) => s + 1);
          } else if (event["type"] === "llm.usage") {
            const inputTokens =
              typeof event["input_tokens"] === "number"
                ? event["input_tokens"]
                : 0;
            const outputTokens =
              typeof event["output_tokens"] === "number"
                ? event["output_tokens"]
                : 0;
            setTotalTokens((t) => t + inputTokens + outputTokens);
          } else if (event["type"] === "permission.requested") {
            const toolName =
              typeof event["tool_name"] === "string"
                ? event["tool_name"]
                : "unknown";
            const paramsPreview =
              typeof event["params_preview"] === "string"
                ? event["params_preview"]
                : "";
            const toolUseId =
              typeof event["tool_use_id"] === "string"
                ? event["tool_use_id"]
                : "";
            setPermissionRequest({ toolName, paramsPreview, toolUseId });
            setRunStatus("waiting");
          } else if (event["type"] === "session.waiting_for_input") {
            // Chat session is ready for next message
            setRunStatus("idle");
            setPermissionRequest(null);
          } else if (event["type"] === "session.closed") {
            setRunStatus("idle");
          }
          return Promise.resolve();
        });

        // Subscribe to event topics from the daemon
        await client.sendCommand("event.subscribe", {
          topics: [
            "run.*",
            "step.*",
            "tool.*",
            "llm.*",
            "permission.*",
            "session.*",
          ],
          scope: "global",
        });

        // Create a persistent chat session for multi-turn conversation
        const result = await client.sendCommand("session.create", {
          mode: "chat",
          title: "TUI Session",
        });
        const sid = result["session_id"];
        if (typeof sid === "string") {
          sessionIdRef.current = sid;
        }
      } catch (error) {
        console.error("Failed to connect:", error);
        setConnected(false);
      }
    };

    void connect();

    return () => {
      // Close session on unmount
      if (sessionIdRef.current) {
        void client.sendCommand("session.close", {
          session_id: sessionIdRef.current,
        });
      }
      client.close();
    };
  }, [client]);

  // Timer for elapsed time
  useEffect(() => {
    if (runStatus === "running") {
      const interval = setInterval(() => {
        setElapsedMs((ms) => ms + 1000);
      }, 1000);
      return () => {
        clearInterval(interval);
      };
    }
  }, [runStatus]);

  // Handle user input submission via session.send_message
  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim() || !connected) return;
      if (!sessionIdRef.current) {
        console.error("No active session");
        return;
      }

      setInputValue("");
      setRunStatus("running");

      try {
        await client.sendCommand("session.send_message", {
          session_id: sessionIdRef.current,
          content: value,
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        setRunStatus("idle");
      }
    },
    [connected, client],
  );

  // Handle permission response
  const handlePermissionRespond = useCallback(
    async (decision: string) => {
      if (!permissionRequest) return;

      try {
        await client.sendCommand("permission.respond", {
          tool_use_id: permissionRequest.toolUseId,
          decision,
        });
        setPermissionRequest(null);
        setRunStatus("running");
      } catch (error) {
        console.error("Failed to respond to permission:", error);
      }
    },
    [permissionRequest, client],
  );

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    } else if (key.ctrl && input === "l") {
      setEvents([]);
    }
  });

  const sessionLabel = sessionIdRef.current
    ? sessionIdRef.current.slice(0, 16)
    : "connecting...";

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header
        version={version}
        connected={connected}
        sessionTitle={sessionLabel}
      />

      <Box flexDirection="column" flexGrow={1} padding={1}>
        <EventLog events={events} height={30} />
      </Box>

      <StatusBar
        runStatus={runStatus}
        step={step}
        totalTokens={totalTokens}
        elapsedMs={elapsedMs}
      />

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={(value) => {
          void handleSubmit(value);
        }}
        disabled={
          runStatus === "running" || runStatus === "waiting" || !connected
        }
        placeholder="Type a message... (Ctrl+C to exit)"
      />

      <PermissionPrompt
        visible={permissionRequest !== null}
        toolName={permissionRequest?.toolName ?? ""}
        paramsPreview={permissionRequest?.paramsPreview ?? ""}
        toolUseId={permissionRequest?.toolUseId ?? ""}
        onRespond={(decision) => {
          void handlePermissionRespond(decision);
        }}
      />
    </Box>
  );
}
