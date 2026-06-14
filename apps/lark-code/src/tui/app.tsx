// Main TUI application: orchestrates components and event loop
// Claude Code style: minimal chrome, flowing layout, no visual occlusion
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";

import { Header } from "./components/header.js";
import { StatusBar } from "./components/status-bar.js";
import { EventLog } from "./components/event-log.js";
import { InputBar } from "./components/input-bar.js";
import { PermissionPrompt } from "./components/permission-prompt.js";
import { SlashCompletePopup } from "./components/slash-complete-popup.js";
import type { AgentEvent } from "./components/event-card.js";
import type { SocketClient } from "../core/transport/socket-client.js";
import type { LarkConfig } from "../core/config.js";
import { SkillLoader } from "../core/skills/loader.js";
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
  const [contextPercent, setContextPercent] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    paramsPreview: string;
    toolUseId: string;
  } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const subagentStartTimes = useRef<Map<string, number>>(new Map());
  const lastRunIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Load available slash commands (builtin + skills)
  const [availableCommands] = useState(() => {
    const loader = new SkillLoader();
    const skills = loader.listAllSkills();
    const commands = [
      { name: "compact", description: "Compress conversation context" },
      ...skills.map((s) => ({ name: s.name, description: s.description })),
    ];
    return commands;
  });

  // Connect to daemon with auto-reconnect and create a persistent chat session
  useEffect(() => {
    isMountedRef.current = true;

    const connect = async () => {
      while (isMountedRef.current) {
        try {
          await client.connect();
          setConnected(true);
          setConnectionError(null);

          // Subscribe to all events
          client.onEvent((event) => {
            const agentEvent: AgentEvent = {
              type:
                typeof event["type"] === "string" ? event["type"] : "unknown",
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
              setContextPercent(0);
              // Track the current run ID for replay on reconnect
              const runId =
                typeof event["run_id"] === "string" ? event["run_id"] : null;
              if (runId) {
                lastRunIdRef.current = runId;
              }
            } else if (event["type"] === "run.finished") {
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

              // Track context percentage for auto-compact awareness
              const ctxPct =
                typeof event["context_percent"] === "number"
                  ? event["context_percent"]
                  : 0;
              setContextPercent(ctxPct);
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
              setRunStatus("idle");
              setPermissionRequest(null);
            } else if (event["type"] === "session.closed") {
              setRunStatus("idle");
            } else if (event["type"] === "context.compacted") {
              // Reset context percentage after compaction
              setContextPercent(0);
            } else if (event["type"] === "tool.call_finished") {
              // Accumulate server-side tool execution time
              const toolElapsed =
                typeof event["elapsed_ms"] === "number"
                  ? event["elapsed_ms"]
                  : 0;
              setElapsedMs((ms) => ms + toolElapsed);
            } else if (event["type"] === "tool.call_failed") {
              // Accumulate server-side tool execution time even on failure
              const toolElapsed =
                typeof event["elapsed_ms"] === "number"
                  ? event["elapsed_ms"]
                  : 0;
              setElapsedMs((ms) => ms + toolElapsed);
            } else if (event["type"] === "subagent.started") {
              // Record subagent start time for client-side elapsed calculation
              const runId =
                typeof event["run_id"] === "string" ? event["run_id"] : "";
              if (runId) {
                subagentStartTimes.current.set(runId, Date.now());
              }
            } else if (event["type"] === "subagent.finished") {
              // Calculate and accumulate subagent elapsed time
              const runId =
                typeof event["run_id"] === "string" ? event["run_id"] : "";
              const startTime = subagentStartTimes.current.get(runId);
              if (startTime !== undefined) {
                const elapsed = Date.now() - startTime;
                setElapsedMs((ms) => ms + elapsed);
                subagentStartTimes.current.delete(runId);
              }
            }
            return Promise.resolve();
          });

          // Subscribe to event topics from the daemon
          // If reconnecting with a previous run ID, replay events from that run
          const subscribeParams: Record<string, unknown> = {
            topics: [
              "run.*",
              "step.*",
              "tool.*",
              "llm.*",
              "permission.*",
              "session.*",
              "subagent.*",
              "context.*",
              "log.*",
              "skill.*",
            ],
            scope: "global",
          };
          if (lastRunIdRef.current) {
            subscribeParams["replay_from_run"] = lastRunIdRef.current;
          }
          await client.sendCommand("event.subscribe", subscribeParams);

          // Create a persistent chat session for multi-turn conversation
          const result = await client.sendCommand("session.create", {
            mode: "chat",
            title: "TUI Session",
          });
          const sid = result["session_id"];
          if (typeof sid === "string") {
            sessionIdRef.current = sid;
          }

          // Connection successful, break out of retry loop
          break;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          setConnectionError(errorMsg);
          console.error("Failed to connect, retrying in 2s:", error);
          setConnected(false);

          // Wait 2 seconds before retrying
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 2000);
          });
        }
      }
    };

    void connect();

    return () => {
      isMountedRef.current = false;
      if (sessionIdRef.current) {
        void client.sendCommand("session.close", {
          session_id: sessionIdRef.current,
        });
      }
      client.close();
    };
  }, [client]);

  // Track elapsed time from server-side tool events and client-side subagent timing
  // Note: We no longer use a client-side setInterval timer. Instead:
  // - Tool execution time comes from tool.call_finished/tool.call_failed events (server-side elapsed_ms)
  // - Subagent execution time is calculated client-side using start timestamps

  // Handle user input submission — supports /compact command
  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim() || !connected) return;
      if (!sessionIdRef.current) {
        console.error("No active session");
        return;
      }

      const trimmed = value.trim();

      // /compact command: trigger session compaction
      if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
        setInputValue("");
        setRunStatus("running");

        try {
          const focus = trimmed.startsWith("/compact ")
            ? trimmed.slice(8).trim()
            : "";
          const result = await client.sendCommand("session.compact", {
            session_id: sessionIdRef.current,
            focus,
          });

          // Add a compact event to the event log
          const summaryTokens =
            typeof result["summary_tokens"] === "number"
              ? result["summary_tokens"]
              : 0;
          const savedTokens =
            typeof result["saved_tokens"] === "number"
              ? result["saved_tokens"]
              : 0;
          const originalTokens = summaryTokens + savedTokens;
          setEvents((prev) => [
            ...prev,
            {
              type: "context.compacted",
              data: {
                original_tokens: originalTokens,
                summary_tokens: summaryTokens,
              },
              timestamp: new Date().toISOString(),
            },
          ]);

          setContextPercent(0);
          setRunStatus("idle");
        } catch (error) {
          console.error("Compact failed:", error);
          setRunStatus("idle");
        }
        return;
      }

      // Normal message submission
      setInputValue("");
      setRunStatus("running");

      try {
        await client.sendCommand("session.send_message", {
          session_id: sessionIdRef.current,
          content: trimmed,
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
      // Graceful exit: close session before exiting
      const closeAndExit = async () => {
        if (sessionIdRef.current) {
          try {
            await client.sendCommand("session.close", {
              session_id: sessionIdRef.current,
            });
          } catch {
            // Best effort — session may already be closed
          }
        }
        client.close();
        exit();
      };
      void closeAndExit();
    } else if (key.ctrl && input === "l") {
      setEvents([]);
    }
  });

  const sessionLabel = sessionIdRef.current
    ? sessionIdRef.current.slice(0, 16)
    : "connecting...";

  // Determine if slash complete popup should be shown
  const showSlashPopup = inputValue.startsWith("/");
  const slashFilter = showSlashPopup ? inputValue.slice(1) : "";

  // Handle slash command selection
  const handleSlashSelect = useCallback((command: { name: string }) => {
    setInputValue(`/${command.name} `);
  }, []);

  // Handle slash popup cancellation
  const handleSlashCancel = useCallback(() => {
    // Do nothing, just hide the popup (it will hide when input no longer starts with /)
  }, []);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header
        version={version}
        connected={connected}
        sessionTitle={sessionLabel}
        errorMessage={connectionError}
      />

      {/* Event stream — grows dynamically, no fixed height occlusion */}
      <EventLog events={events} />

      {/* Status + permission + input — compact bottom section */}
      <StatusBar
        runStatus={runStatus}
        step={step}
        totalTokens={totalTokens}
        elapsedMs={elapsedMs}
        contextPercent={contextPercent}
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

      {showSlashPopup ? (
        <SlashCompletePopup
          commands={availableCommands}
          filter={slashFilter}
          onSelect={handleSlashSelect}
          onCancel={handleSlashCancel}
        />
      ) : null}

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={(value) => {
          void handleSubmit(value);
        }}
        disabled={
          runStatus === "running" || runStatus === "waiting" || !connected
        }
        placeholder="Type a message… (/compact to compress context)"
      />
    </Box>
  );
}
