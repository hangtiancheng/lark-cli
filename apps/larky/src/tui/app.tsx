import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import type { ProviderConfig, MCPServerConfig, HookConfig } from "../config/config.js";
import { getContextWindow, getContextWindowAsync, getMaxOutputTokens } from "../config/config.js";
import type { LLMClient } from "../llm/client.js";
import { createClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import { buildSystemPrompt, detectEnvironment } from "../prompt/builder.js";
import { ToolRegistry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/read-file.js";
import { BashTool } from "../tools/bash.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { WriteFileTool } from "../tools/write-file.js";
import { EditFileTool } from "../tools/edit-file.js";
import { ExitPlanModeTool } from "../tools/exit-plan-mode.js";
import { PlanApprovalDialog, type PlanChoice } from "./plan-approval.js";
import { ToolSearchTool } from "../tools/tool-search.js";
import { EnterWorktreeTool } from "../tools/enter-worktree.js";
import { ExitWorktreeTool } from "../tools/exit-worktree.js";
import { Agent } from "../agent/agent.js";
import { PermissionChecker, type PermissionMode } from "../permissions/checker.js";
import {
  parse as parseCommand,
  createDefaultRegistry as createCommandRegistry,
  type CommandRegistry,
  type Command,
} from "../commands/commands.js";
import { loadUserCommands } from "../commands/loader.js";
import { expandAtRefs } from "./at-expand.js";
import { MCPManager } from "../mcp/manager.js";
import { MCPToolWrapper } from "../mcp/tool-wrapper.js";
import { loadInstructions } from "../memory/instructions.js";
import { MemoryManager } from "../memory/manager.js";
import { MemoryExtractor } from "../memory/extractor.js";
import { SkillCatalog } from "../skills/catalog.js";
import { TaskList } from "../todo/todo.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../todo/tools.js";
import { TaskStore } from "../todo/store.js";
import { AgentTool } from "../sub-agent/agent-tool.js";
import { spawnSubAgent } from "../sub-agent/spawn.js";
import { BUILTIN_AGENTS } from "../sub-agent/definition.js";
import type { RunAgent } from "../teams/team.js";
import {
  TeamCreateTool,
  SpawnTeammateTool,
  SendMessageTool,
  ListTeamsTool,
  TeamDeleteTool,
} from "../teams/tools.js";
import { HookEngine, validate as validateHooks } from "../hooks/hooks.js";
import { forceCompact } from "../compact/compact.js";
import { RecoveryState } from "../compact/recovery.js";
import { ContentReplacementState } from "../tool-result/state.js";
import {
  getOrCreatePlanPath,
  loadPlan,
  planExists,
  resetPlanPath,
} from "../plan-file/plan-file.js";
import { buildPlanModeExitReminder, buildPlanModeReentryReminder } from "../prompt/plan-mode.js";
import { runInline as runSkillInline, runFork as runSkillFork } from "../skills/executor.js";
import { LoadSkillTool } from "../skills/load-skill-tool.js";
import { InstallSkillTool } from "../skills/install-tool.js";
import type { SkillHost, SkillForkHost } from "../skills/skill.js";
import { TeamManager } from "../teams/team.js";
import { coordinatorToolFilter } from "../teams/coordinator.js";
import { FileHistory } from "../file-history/file-history.js";
import { FileStateCache } from "../tools/file-state-cache.js";
import type { Snapshot } from "../file-history/file-history.js";
import RewindDialog, { type RewindAction } from "./rewind-dialog.js";
import { PermissionDialog, type PermissionAction } from "./permission-dialog.js";
import AskUserDialog from "./ask-user-dialog.js";
import { TeammateSpinnerTree } from "./teammate-spinner-tree.js";
import { TeamStatus } from "./team-status.js";
import { TeamsDialog } from "./teams-dialog.js";
import type { TeammateUIState } from "../teams/progress.js";
import { AskUserQuestionTool, type Question } from "../tools/ask-user.js";
import { existsSync, readFileSync } from "node:fs";
import * as sessionMod from "../session/session.js";
import * as historyMod from "../history/history.js";
import { ProviderSelect } from "./provider-select.js";
import { InputBox } from "./input.js";
import { StatusBar } from "./status-bar.js";
import { ChatView, CommittedMessage, type ChatMessage, type ToolSummaryItem } from "./chat.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";
import Spinner from "./spinner.js";
import { COLORS, ICONS } from "./styles.js";
import { CommandUsageTracker } from "../commands/usage-tracker.js";
import { randomCompletionVerb } from "./verbs.js";
import { asErrorString, asRecord, strArg } from "@/utils/index.js";

type AppState = "providerSelect" | "chat";

interface Props {
  providers: ProviderConfig[];
  mcpServers: MCPServerConfig[];
  hooks: HookConfig[];
}

function createToolRegistry(taskList: TaskList): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new ToolSearchTool(registry));
  registry.register(new EnterWorktreeTool());
  registry.register(new ExitWorktreeTool());
  registry.register(new ExitPlanModeTool());
  registry.register(new TaskCreateTool(taskList));
  registry.register(new TaskGetTool(taskList));
  registry.register(new TaskListTool(taskList));
  registry.register(new TaskUpdateTool(taskList));
  return registry;
}

/**
 * wireSkillsToRegistry registers every loaded skill as a slash command in the
 * CommandRegistry, mirroring Go's wireSkillsToAgent. Inline skills become
 * "prompt" commands whose handler renders the skill body; fork-mode skills
 * become "skill_fork" commands (dispatched separately in executeCommand).
 *
 * Idempotent: silently skips a name that's already taken (e.g. a built-in or
 * user command registered earlier), matching Go's precedence rules.
 */
function wireSkillsToRegistry(
  catalog: SkillCatalog,
  cmdRegistry: CommandRegistry,
  skillHost: SkillHost,
): void {
  for (const meta of catalog.list()) {
    // Don't shadow existing built-in or user commands.
    if (cmdRegistry.find(meta.name)) {
      continue;
    }

    const skill = catalog.get(meta.name);
    if (!skill) {
      continue;
    }

    const isFork = skill.meta.mode === "fork";

    const cmd: Command = {
      name: meta.name,
      aliases: [],
      type: isFork ? "skill_fork" : "prompt",
      description: `${meta.description} [skill]`,
      handler: isFork
        ? () => "" // fork dispatch handled in executeCommand before handler
        : (ctx) => runSkillInline(skill, ctx.args, skillHost),
    };
    try {
      cmdRegistry.register(cmd);
    } catch {
      // name clash → keep the existing command
    }
  }
}

export function App(props: Props) {
  const { providers, mcpServers, hooks } = props;

  const { exit } = useApp();
  const [appState, setAppState] = useState<AppState>(
    providers.length === 1 ? "chat" : "providerSelect",
  );
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig>(providers[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [completionMark, setCompletionMark] = useState<string | null>(null);
  const streamStartRef = useRef(0);
  const streamingTextRef = useRef("");
  // Tracks how many messages from the start of `messages` are "committed" —
  // i.e. belong to completed turns. Committed messages are rendered via Ink's
  // <Static> component (rendered once, never re-rendered), eliminating flicker.
  const committedIndexRef = useRef(0);
  const [activeTools, setActiveTools] = useState<ToolBlockInfo[]>([]);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [permMode, setPermMode] = useState<PermissionMode>(
    process.env.LARKY_BYPASS_PERMISSIONS === "1" ? "bypassPermissions" : "default",
  );

  const [error, setError] = useState<string | null>(null);
  const [planApprovalActive, setPlanApprovalActive] = useState(false);
  const [prePlanMode, setPrePlanMode] = useState<PermissionMode>("default");
  // Tracks whether Plan Mode has ever been exited in the current session, used to inject prompts on re-entry
  const hasExitedPlanModeRef = useRef(false);
  const permModeRef = useRef(permMode);
  useEffect(() => {
    permModeRef.current = permMode;
  }, [permMode]);
  const [mcpInfo, setMcpInfo] = useState<{
    servers: string[];
    toolCount: number;
  } | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const workDir = process.cwd();
  const historyDir = `${workDir}/.larky`;

  const clientRef = useRef<LLMClient | null>(null);
  // Resolved context window for the active provider. Seeded synchronously
  // (layers 1/3/4) and upgraded in initClient via the async auto-fetch (layer 2).
  const contextWindowRef = useRef(getContextWindow(providers[0]));
  const conversationRef = useRef(new ConversationManager());
  const sessionIdRef = useRef(sessionMod.newSessionId());
  const taskListRef = useRef(new TaskList(new TaskStore(workDir, sessionIdRef.current)));
  const registryRef = useRef(
    (() => {
      const reg = createToolRegistry(taskListRef.current);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const exitPlan = reg.get("ExitPlanMode") as ExitPlanModeTool | undefined;
      if (exitPlan) {
        exitPlan.isPlanMode = () => permModeRef.current === "plan";
        exitPlan.planExists = () => {
          const p = getOrCreatePlanPath(workDir);
          return existsSync(p);
        };
      }
      return reg;
    })(),
  );
  const cmdRegistryRef = useRef(createCommandRegistry());
  const usageTrackerRef = useRef(new CommandUsageTracker(workDir));
  const mcpManagerRef = useRef<MCPManager | null>(null);
  const hookEngineRef = useRef<HookEngine | null>(null);
  const skillCatalogRef = useRef<SkillCatalog | null>(null);
  const recoveryStateRef = useRef(new RecoveryState());
  const replacementStateRef = useRef(new ContentReplacementState());
  const memCursorRef = useRef(0);
  const memExtractingRef = useRef(false);
  const activeSkillsRef = useRef(new Map<string, string>());
  const toolFilterRef = useRef<((name: string) => boolean) | null>(null);
  const skillHostRef = useRef<SkillHost>({
    activateSkill: (name, body) => activeSkillsRef.current.set(name, body),
    setToolFilter: (filter) => {
      toolFilterRef.current = filter;
    },
    toolRegistry: () => registryRef.current,
  });
  const teamManagerRef = useRef(new TeamManager(workDir));
  const fileHistoryRef = useRef<FileHistory | null>(null);
  const fileStateCacheRef = useRef(new FileStateCache());
  const abortControllerRef = useRef<AbortController | null>(null);
  const permissionResolveRef = useRef<((v: "allow" | "deny" | "allowAlways") => void) | null>(null);
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [rewindSnapshots, setRewindSnapshots] = useState<Snapshot[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    argsSummary: string;
    reason: string;
  } | null>(null);
  const [askRequest, setAskRequest] = useState<Question[] | null>(null);
  const askResolveRef = useRef<((a: Record<string, string>) => void) | null>(null);
  const [teammateStates, setTeammateStates] = useState<TeammateUIState[]>([]);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [subagents, setSubagents] = useState<
    { id: number; label: string; turn: number; lastTool?: string }[]
  >([]);
  const subagentIdRef = useRef(0);
  // Poll teammate states from TeamManager every 500ms for live progress.
  useEffect(() => {
    const timer = setInterval(() => {
      const states = teamManagerRef.current.getAllTeammateStates();
      setTeammateStates(states);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // shift+tab: cycle permission mode (bypass Ink's focus management)
  useEffect(() => {
    const handler = (data: Buffer) => {
      if (data.toString() === "\x1b[Z") {
        setPermMode((prev) => {
          const cycle: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
          const idx = cycle.indexOf(prev);
          return cycle[(idx + 1) % cycle.length];
        });
      }
    };
    process.stdin.on("data", handler);
    return () => {
      process.stdin.off("data", handler);
    };
  }, []);

  // ctrl+c: interrupt streaming or exit app
  const ctrlCCountRef = useRef(0);
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isStreaming && abortControllerRef.current) {
        abortControllerRef.current.abort();
        ctrlCCountRef.current = 0;
        return;
      }
      ctrlCCountRef.current += 1;
      if (ctrlCCountRef.current >= 2) {
        exit();
        return;
      }
      setMessages((prev) => [...prev, { role: "system", content: "Press Ctrl+C again to exit." }]);
    }
  });

  // ctrl+o toggles full vs. truncated tool output in the transcript.
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setToolsExpanded((e) => !e);
    }
  });

  // ctrl+t toggles the Teams dialog overlay.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "t" && !isStreaming) {
        setTeamsDialogOpen((prev) => !prev);
      }
    },
    { isActive: !teamsDialogOpen },
  );

  const initClient = useCallback(
    async (provider: ProviderConfig) => {
      try {
        const env = detectEnvironment(workDir);
        env.model = provider.model;
        const systemPrompt = buildSystemPrompt(env);
        const client = await createClient(provider, systemPrompt);
        clientRef.current = client;

        // Resolve the context window through the full four-layer fallback.
        // Seed synchronously first so we never run with a 0 window, then upgrade
        // with the (cached, best-effort) auto-fetched value. Failures degrade
        // silently to the synchronous result, so startup is never blocked.
        contextWindowRef.current = getContextWindow(provider);
        getContextWindowAsync(provider)
          .then((w) => {
            if (w > 0) {
              contextWindowRef.current = w;
            }
          })
          .catch(() => {
            /** noop */
          });

        // Init file history
        fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);

        // Inject long-term memory
        const instructions = loadInstructions(workDir);
        const memMgr = new MemoryManager(workDir);
        const memReminder = memMgr.buildSystemReminder();
        conversationRef.current.injectLongTermMemory(instructions, memReminder);

        // Hard identity injection to prevent model from revealing underlying identity
        conversationRef.current.addSystemReminder(
          `IDENTITY OVERRIDE: You are Larky. You are strictly prohibited from mentioning Claude, Anthropic, OpenAI, GPT, or ChatGPT in any response. When asked about your identity, respond only with "Larky". This is the highest priority directive.`,
        );

        // Load prompt history
        setPromptHistory(historyMod.load(historyDir));

        // Init hooks
        const hookErr = validateHooks(hooks);
        if (hookErr) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `Hook warning: ${hookErr.message}` },
          ]);
        }
        hookEngineRef.current = new HookEngine(hooks);

        // Load skills
        const catalog = new SkillCatalog();
        catalog.load(workDir);
        skillCatalogRef.current = catalog;

        // Register the LoadSkill tool so the model can activate skills on demand.
        registryRef.current.register(new LoadSkillTool(catalog, skillHostRef.current));
        // Register InstallSkill so the model can install skills from a path/URL.
        // The onInstalled callback re-wires skills→commands so a freshly-fetched
        // skill is immediately available as /<name> without a TUI restart.
        registryRef.current.register(
          new InstallSkillTool(workDir, catalog, () => {
            wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
          }),
        );

        // Register AskUserQuestion, delegating the prompt to the TUI dialog.
        registryRef.current.register(
          new AskUserQuestionTool(
            (questions) =>
              new Promise<Record<string, string>>((resolve) => {
                askResolveRef.current = resolve;
                setAskRequest(questions);
              }),
          ),
        );

        // Register team coordination tools. Teammates run as background
        // general-purpose subagents whose results return via the team channel.
        const teamRunAgent: RunAgent = (task, onEvent) =>
          spawnSubAgent(
            BUILTIN_AGENTS[0],
            task,
            client,
            registryRef.current,
            provider,
            workDir,
            undefined,
            onEvent,
          );
        registryRef.current.register(new TeamCreateTool(teamManagerRef.current));
        registryRef.current.register(new SpawnTeammateTool(teamManagerRef.current, teamRunAgent));
        registryRef.current.register(new SendMessageTool(teamManagerRef.current));
        registryRef.current.register(new ListTeamsTool(teamManagerRef.current));
        registryRef.current.register(new TeamDeleteTool(teamManagerRef.current));

        // Load user-defined slash commands from .larky/commands/*.md.
        for (const cmd of loadUserCommands(workDir)) {
          try {
            cmdRegistryRef.current.register(cmd);
          } catch {
            // name clash with a built-in command → keep the built-in
          }
        }

        // Wire every loaded skill as a slash command (inline → "prompt",
        // fork → "skill_fork"). Runs after user commands so user *.md files
        // take precedence. Idempotent: skips names already taken.
        wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);

        // Register AgentTool with real spawn + live progress reporting.
        registryRef.current.register(
          new AgentTool(workDir, registryRef.current, async (def, prompt, _bg, modelOverride?) => {
            const id = ++subagentIdRef.current;
            setSubagents((prev) => [...prev, { id, label: def.name, turn: 0 }]);
            const onProgress = (p: { turn?: number; lastTool?: string }) => {
              setSubagents((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
            };
            try {
              return await spawnSubAgent(
                def,
                prompt,
                client,
                registryRef.current,
                provider,
                workDir,
                onProgress,
                undefined,
                modelOverride,
              );
            } finally {
              setSubagents((prev) => prev.filter((s) => s.id !== id));
            }
          }),
        );

        // Connect MCP servers in background
        if (mcpServers.length > 0) {
          const mgr = new MCPManager();
          mcpManagerRef.current = mgr;
          await mgr.connectAll(mcpServers).then((result) => {
            for (const { serverName, tool } of result.tools) {
              const client = mgr.getClient(serverName);
              if (client) {
                registryRef.current.register(new MCPToolWrapper(client, serverName, tool));
              }
            }
            if (result.errors.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `MCP errors: ${result.errors.map((e) => `${e.serverName}: ${e.error}`).join("; ")}`,
                },
              ]);
            }
            if (result.servers.length > 0) {
              setMcpInfo({
                servers: result.servers,
                toolCount: result.tools.length,
              });
            }
            // Inject each server's instructions into the conversation so the
            // model knows how to use that server's tools. Mirrors Go.
            for (const { serverName, text } of result.instructions) {
              conversationRef.current.addSystemReminder(`# MCP Server: ${serverName}\n${text}`);
            }
          });
        }
      } catch (err) {
        setError(`Failed to init LLM client: ${asErrorString(err)}`);
      }
    },
    [workDir, mcpServers],
  );

  useEffect(() => {
    if (appState === "chat" && !clientRef.current) {
      void initClient(selectedProvider);
    }
  }, [appState, selectedProvider, initClient]);

  const handleProviderSelect = (provider: ProviderConfig) => {
    setSelectedProvider(provider);
    setAppState("chat");
  };

  const handleSlashCommand = async (text: string): Promise<boolean> => {
    let parsed = parseCommand(text);
    if (!parsed) {
      return false;
    }

    // /mcp — show MCP server status
    if (parsed.name === "mcp") {
      if (!mcpInfo || mcpInfo.servers.length === 0) {
        setMessages((prev) => [...prev, { role: "system", content: "No MCP servers connected." }]);
      } else {
        const lines = [
          `MCP servers (${String(mcpInfo.servers.length)}):`,
          ...mcpInfo.servers.map((s) => `  · ${s}`),
          `Tools: ${String(mcpInfo.toolCount)} total`,
        ];
        setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      }
      usageTrackerRef.current.record("mcp");
      return true;
    }

    // `/skill <name> [args]` shorthand: rewrite to `/<name> [args]` so it
    // goes through the normal command registry path (skills are wired there).
    if (parsed.name === "skill" && parsed.args.trim()) {
      const parts = parsed.args.trim().split(/\s+/);
      parsed = { name: parts[0], args: parts.slice(1).join(" ") };
    }

    const cmd = cmdRegistryRef.current.find(parsed.name);
    if (cmd) {
      usageTrackerRef.current.record(cmd.name);
    }
    if (!cmd) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Unknown command: /${parsed.name}` },
      ]);
      return true;
    }

    // Rich status/memory commands need live app state, so handle them here.
    if (cmd.name === "status") {
      const lines = [
        `Mode:      ${permMode}`,
        `Model:     ${selectedProvider.model}`,
        `Provider:  ${selectedProvider.name} (${selectedProvider.protocol})`,
        `Tokens:    ${String(inputTokens)} in / ${String(outputTokens)} out`,
        `Tools:     ${String(registryRef.current.listTools().length)}`,
        `Memories:  ${String(new MemoryManager(workDir).getMemories().length)}`,
        `Skills:    ${String(skillCatalogRef.current?.list().length ?? 0)}`,
        `MCP:       ${String(mcpInfo?.servers.length ?? 0)} server(s), ${String(mcpInfo?.toolCount ?? 0)} tool(s)`,
        `Session:   ${sessionIdRef.current}`,
        `Directory: ${workDir}`,
      ];
      setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      return true;
    }
    if (cmd.name === "permission") {
      const parts = parsed.args.trim().split(/\s+/);
      const modes: string[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
      if (parts[0] === "mode" && parts[1]) {
        if (modes.includes(parts[1])) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          setPermMode(parts[1] as PermissionMode);
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `Permission mode → ${parts[1]}` },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Unknown mode '${parts[1]}'. Valid: ${modes.join(", ")}`,
            },
          ]);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content:
              `Permission mode: ${permMode}\n` +
              "Change with shift+tab, or /permission mode <default|acceptEdits|plan|bypassPermissions>",
          },
        ]);
      }
      return true;
    }
    if (cmd.name === "memory") {
      const sub = parsed.args.trim().split(/\s+/)[0];
      const mgr = new MemoryManager(workDir);
      if (sub === "clear") {
        mgr.clear();
        setMessages((prev) => [...prev, { role: "system", content: "All memories cleared." }]);
      } else {
        const mems = mgr.getMemories();
        const body =
          mems.length === 0
            ? "No memories saved yet. They are auto-extracted; /memory clear wipes them."
            : `Memories (${String(mems.length)}):\n` +
              mems.map((m) => `  [${m.type}] ${m.name} — ${m.description}`).join("\n");
        setMessages((prev) => [...prev, { role: "system", content: body }]);
      }
      return true;
    }

    if (cmd.type === "local_ui") {
      const action = cmd.handler({ workDir, args: parsed.args });
      switch (action) {
        case "clear":
          setMessages([]);
          committedIndexRef.current = 0;
          conversationRef.current = new ConversationManager();
          break;
        case "quit":
          exit();
          break;
        case "plan": {
          setPrePlanMode(permMode);
          setPermMode("plan");
          const planPath = getOrCreatePlanPath(workDir);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                `Entered plan mode (read-only). Plan file: ${planPath}\n` +
                "Investigate and design your approach. The agent will call ExitPlanMode when the plan is ready.",
            },
          ]);
          // Re-entry detection: If Plan Mode has been exited in this session and the plan file exists, inject re-entry prompts
          if (hasExitedPlanModeRef.current && planExists(workDir)) {
            const reentryMsg = buildPlanModeReentryReminder(planPath, true);
            if (reentryMsg) {
              conversationRef.current.addSystemReminder(reentryMsg);
              setMessages((prev) => [...prev, { role: "system", content: reentryMsg }]);
            }
            hasExitedPlanModeRef.current = false;
          }
          break;
        }
        case "do": {
          setPermMode("default");
          // Mark that Plan Mode has been exited in this session, so prompts can be injected upon re-entry.
          hasExitedPlanModeRef.current = true;
          const planContent = loadPlan();
          const exitPlanPath = getOrCreatePlanPath(workDir);
          conversationRef.current.addSystemReminder(
            buildPlanModeExitReminder(exitPlanPath, !!planContent),
          );
          if (planContent?.trim()) {
            // Feed the approved plan back to the agent and execute it.
            conversationRef.current.addUserMessage(
              "The plan below has been approved. Exit plan mode and carry it out now.\n\n" +
                "# Approved Plan\n" +
                planContent,
            );
            resetPlanPath();
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "✓ Plan approved — executing." },
            ]);
            await runAgentLoop("default");
          } else {
            setMessages((prev) => [...prev, { role: "system", content: "Exited plan mode." }]);
          }
          break;
        }
        case "compact":
          if (clientRef.current) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Compacting conversation..." },
            ]);
            forceCompact(
              conversationRef.current,
              clientRef.current,
              recoveryStateRef.current,
              registryRef.current.listTools().map((t) => t.name),
            )
              .then((result) => {
                // Persist the boundary so the compacted state survives /resume.
                if (result.boundary) {
                  sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, result.boundary);
                }
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: `Compact: ${result.message}` },
                ]);
              })
              .catch((err: unknown) => {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "system",
                    content: `Compact failed: ${asErrorString(err)}`,
                  },
                ]);
              });
          }
          break;
        case "resume": {
          const arg = parsed.args.trim();
          if (!arg) {
            const sessions = sessionMod.listSessions(workDir);
            if (sessions.length === 0) {
              setMessages((prev) => [...prev, { role: "system", content: "No sessions found." }]);
            } else {
              const list = sessions
                .slice(0, 10)
                .map((s) => `  ${s.id} (${String(s.messageCount)} msgs) — ${s.firstMessage}`)
                .join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Sessions (use /resume <id> to restore):\n${list}`,
                },
              ]);
            }
            break;
          }

          const saved = sessionMod.loadSession(workDir, arg);
          if (saved.length === 0) {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Session "${arg}" not found or empty.`,
              },
            ]);
            break;
          }

          // Rebuild the conversation (with long-term memory re-injected) and the
          // visible transcript from the saved messages, then continue under the
          // resumed session id. rebuildFromSession honors compaction: if the
          // session contains a compact_boundary it replays the compacted state
          // (summary + inlined keep + post-boundary appends) instead of the full
          // pre-boundary history; with no boundary it replays everything.
          const conversation = new ConversationManager();
          conversation.injectLongTermMemory(
            loadInstructions(workDir),
            new MemoryManager(workDir).buildSystemReminder(),
          );
          const restored = sessionMod.rebuildFromSession(saved);
          for (const m of restored) {
            if (m.role === "user") {
              conversation.addUserMessage(m.content);
            } else {
              conversation.addAssistantMessage(m.content);
            }
          }
          conversationRef.current = conversation;
          sessionIdRef.current = arg;
          // Reload the task list for the resumed session.
          taskListRef.current.useStore(new TaskStore(workDir, arg));
          const resumedMessages: ChatMessage[] = [
            ...restored,
            {
              role: "system",
              content: `⟲ Resumed session ${arg} (${String(restored.length)} messages).`,
            },
          ];
          committedIndexRef.current = resumedMessages.length;
          setMessages(resumedMessages);
          break;
        }
        case "skills": {
          const catalog = skillCatalogRef.current;
          if (!catalog) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Skills: no catalog loaded." },
            ]);
          } else {
            const skills = catalog.list();
            if (skills.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: "No skills found in .larky/skills/.",
                },
              ]);
            } else {
              const list = skills.map((s) => `  /${s.name} — ${s.description}`).join("\n");
              setMessages((prev) => [
                ...prev,
                { role: "system", content: `Available skills:\n${list}` },
              ]);
            }
          }
          break;
        }
        case "worktree": {
          try {
            const { execSync } = await import("node:child_process");
            const output = execSync("git worktree list", {
              cwd: workDir,
              encoding: "utf-8",
            });
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Worktree list:\n${output}` },
            ]);
          } catch {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: "Not a git repository or git worktree not available.",
              },
            ]);
          }
          break;
        }
        case "rewind": {
          const fh = fileHistoryRef.current;
          if (!fh?.hasSnapshots()) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "No checkpoints to rewind to." },
            ]);
          } else {
            setRewindSnapshots(fh.getSnapshots());
            setRewindDialogActive(true);
          }
          break;
        }
      }
      return true;
    }

    if (cmd.type === "local") {
      const output = cmd.handler({ workDir, args: parsed.args });
      setMessages((prev) => [...prev, { role: "system", content: output }]);
      return true;
    }

    if (cmd.type === "prompt") {
      // File-based custom command or inline skill: render the body and run it as a user turn.
      const promptText = cmd.handler({ workDir, args: parsed.args });
      if (clientRef.current && promptText.trim()) {
        setMessages((prev) => [...prev, { role: "user", content: promptText }]);
        conversationRef.current.addUserMessage(promptText);
        sessionMod.saveMessage(workDir, sessionIdRef.current, {
          role: "user",
          content: promptText,
          timestamp: new Date().toISOString(),
        });
        setIsStreaming(true);
        setStreamingText("");
        runAgentLoop()
          .then(() => {
            setIsStreaming(false);
            setActiveTools([]);
          })
          .catch((err: unknown) => {
            setError(asErrorString(err));
            setIsStreaming(false);
          });
      }
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (cmd.type === "skill_fork") {
      const skill = skillCatalogRef.current?.get(parsed.name);
      if (!skill) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `Skill not found: ${parsed.name}` },
        ]);
        return true;
      }
      const client = clientRef.current;
      if (!client) {
        setMessages((prev) => [...prev, { role: "system", content: "Client not ready." }]);
        return true;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Running skill "${parsed.name}" in fork mode…`,
        },
      ]);
      // Build a SkillForkHost backed by the live refs.
      const forkHost: SkillForkHost = {
        ...skillHostRef.current,
        runSubAgent: (prompt, toolFilter) =>
          spawnSubAgent(
            {
              name: skill.meta.name,
              description: skill.meta.description,
              tools: toolFilter,
              model: skill.meta.model,
            },
            prompt,
            client,
            registryRef.current,
            selectedProvider,
            workDir,
          ),
        snapshotParentMessages: (count) => {
          const msgs = conversationRef.current.getMessages();
          return msgs
            .slice(-count)
            .map((m) => `[${m.role}] ${m.content}`)
            .join("\n");
        },
      };
      runSkillFork(skill, parsed.args, forkHost)
        .then((result) => {
          setMessages((prev) => [...prev, { role: "assistant", content: result }]);
        })
        .catch((err: unknown) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Skill fork error: ${asErrorString(err)}`,
            },
          ]);
        });
      return true;
    }

    return false;
  };

  const formatToolArgs = (args: Record<string, unknown>): string => {
    if (args.command) {
      return truncate(strArg(args, "command"), 80);
    }
    if (args.file_path) {
      return truncate(strArg(args, "file_path"), 80);
    }
    if (args.pattern) {
      return truncate(strArg(args, "pattern"), 80);
    }
    return "";
  };

  const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + "…" : s);

  const runAgentLoop = async (modeOverride?: PermissionMode) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // modeOverride avoids a stale-closure read of permMode right after a
    // setPermMode call (e.g. plan approval switching out of plan mode in the same tick).
    const checker = new PermissionChecker(workDir, modeOverride ?? permMode);
    const agent = new Agent({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      client: clientRef.current!,
      registry: registryRef.current,
      checker,
      conversation: conversationRef.current,
      workDir,
      hookEngine: hookEngineRef.current ?? undefined,
      fileHistory: fileHistoryRef.current ?? undefined,
      fileStateCache: fileStateCacheRef.current,
      abortSignal: controller.signal,
      contextWindow: contextWindowRef.current,
      maxOutput: getMaxOutputTokens(selectedProvider),
      recoveryState: recoveryStateRef.current,
      replacementState: replacementStateRef.current,
      activeSkills: activeSkillsRef.current,
      toolFilter: buildComposedToolFilter(
        coordinatorToolFilter(teamManagerRef.current),
        toolFilterRef.current,
      ),
      // Surface teammate results (from team lead mailboxes) as reminders.
      notificationFn: () => teamManagerRef.current.drainLeads(),
      onLoopComplete: (conversation) => {
        // Background auto-memory extraction: skip if nothing new since the last
        // run, and never run two extractions at once (coalesce). Best-effort.
        const client = clientRef.current;
        if (!client || memExtractingRef.current) {
          return;
        }
        if (conversation.len() - memCursorRef.current < 2) {
          return;
        }
        memExtractingRef.current = true;
        const cursor = conversation.len();
        const summary = conversation
          .getMessages()
          .slice(-40)
          .map((m) => `[${m.role}]: ${m.content}`)
          .filter((s) => s.length > 12)
          .join("\n");
        new MemoryExtractor(client, workDir)
          .extract(summary)
          .then((saved) => {
            memCursorRef.current = cursor;
            if (saved.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Memory saved: ${saved.join(", ")}`,
                },
              ]);
            }
          })
          .catch(() => {
            /** noop */
          })
          .finally(() => {
            memExtractingRef.current = false;
          });
      },
      onPermissionRequest: async (toolName, args, decision) => {
        return new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
          permissionResolveRef.current = resolve;
          setPermissionRequest({
            toolName,
            argsSummary: formatToolArgs(args),
            reason: decision.reason,
          });
        });
      },
    });

    let fullText = "";

    // Per-turn accumulators for the folded turn_summary display.
    let turnThinkingText = "";
    let turnThinkingStart = 0;
    let turnThinkingDuration = 0;
    let turnToolCalls: ToolSummaryItem[] = [];
    // Map toolName+toolId -> argsSummary so tool_result can look it up
    // (the agent's tool_result event doesn't carry args).
    const pendingToolArgs = new Map<string, string>();

    const resetTurnAccumulators = () => {
      turnThinkingText = "";
      turnThinkingStart = 0;
      turnThinkingDuration = 0;
      turnToolCalls = [];
      pendingToolArgs.clear();
    };

    for await (const event of agent.run()) {
      switch (event.type) {
        case "stream_text":
          fullText += event.text;
          setStreamingText(fullText);
          streamingTextRef.current = fullText;
          break;

        case "thinking_text":
          if (!turnThinkingStart) {
            turnThinkingStart = Date.now();
          }
          turnThinkingText += event.text;
          break;

        case "thinking_complete":
          if (turnThinkingStart) {
            turnThinkingDuration = (Date.now() - turnThinkingStart) / 1000;
          }
          // Don't add a separate "thinking" message -- it'll be folded into the turn summary.
          break;

        case "tool_use": {
          const argsSummary = formatToolArgs(event.args);
          // Store for lookup when tool_result arrives (it lacks args).
          pendingToolArgs.set(`${event.toolName}:${event.toolId}`, argsSummary);
          // Show the active spinner while the tool runs.
          setActiveTools((prev) => [
            ...prev,
            { toolName: event.toolName, args: event.args, loading: true },
          ]);
          break;
        }

        case "tool_result": {
          // Look up the argsSummary we saved during tool_use.
          const argsSummary = pendingToolArgs.get(`${event.toolName}:${event.toolId}`) ?? "";
          // Update active tools spinner.
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === event.toolName && t.loading
                ? {
                    ...t,
                    output: event.output,
                    isError: event.isError,
                    elapsed: event.elapsed,
                    loading: false,
                  }
                : t,
            ),
          );
          // Accumulate into the turn summary.
          turnToolCalls.push({
            toolName: event.toolName,
            argsSummary,
            output: event.output,
            isError: event.isError,
            elapsed: event.elapsed,
          });
          break;
        }

        case "usage":
          setInputTokens((prev) => prev + event.usage.inputTokens);
          setOutputTokens((prev) => prev + event.usage.outputTokens);
          break;

        case "compact":
          setMessages((prev) => [...prev, { role: "system", content: `⊙ ${event.message}` }]);
          if (event.boundary) {
            sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, event.boundary);
          }
          break;

        case "retry":
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `↻ ${event.reason}${event.delay ? ` (waiting ${String(Math.round(event.delay / 1000))}s)` : ""}`,
            },
          ]);
          break;

        case "turn_complete": {
          setStreamingText("");
          fullText = "";
          setActiveTools([]);
          // Replace individual thinking + tool_use/tool_result messages from
          // this turn with a single collapsed turn_summary message.
          const hasTurnContent = turnThinkingText || turnToolCalls.length > 0;
          if (hasTurnContent) {
            setMessages((prev) => {
              const summary: ChatMessage = {
                role: "turn_summary",
                content: turnThinkingText,
                thinkingDuration: turnThinkingDuration > 0 ? turnThinkingDuration : undefined,
                toolSummary: turnToolCalls.length > 0 ? turnToolCalls : undefined,
              };
              const next = [...prev, summary];
              committedIndexRef.current = next.length;
              return next;
            });
          }
          resetTurnAccumulators();
          break;
        }

        case "loop_complete":
          setStreamingText("");
          if (fullText) {
            setMessages((prev) => {
              const next = [...prev, { role: "assistant" as const, content: fullText }];
              committedIndexRef.current = next.length;
              return next;
            });
            sessionMod.saveMessage(workDir, sessionIdRef.current, {
              role: "assistant",
              content: fullText,
              timestamp: new Date().toISOString(),
            });
          } else {
            // Even when no final text, mark everything committed.
            setMessages((prev) => {
              committedIndexRef.current = prev.length;
              return prev;
            });
          }
          setActiveTools([]);
          resetTurnAccumulators();
          if (permModeRef.current === "plan") {
            setPlanApprovalActive(true);
          }
          break;

        case "error":
          throw event.error;
      }
    }
  };

  const handlePlanApproval = useCallback(
    (choice: PlanChoice, feedback?: string) => {
      setPlanApprovalActive(false);
      const planPath = getOrCreatePlanPath(workDir);
      let planContent = "";
      try {
        if (existsSync(planPath)) {
          planContent = readFileSync(planPath, "utf-8");
        }
      } catch {
        /** noop */
      }

      if (choice === "yolo") {
        // Mark that Plan Mode has been exited in this session, so prompts can be injected upon re-entry.
        hasExitedPlanModeRef.current = true;
        setPermMode("bypassPermissions");
        conversationRef.current.addSystemReminder(
          buildPlanModeExitReminder(planPath, !!planContent),
        );
        setMessages((prev) => [
          ...prev,
          { role: "system", content: "Plan approved. Entered YOLO mode." },
        ]);
        if (planContent) {
          void handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "manual") {
        // Marks that Plan Mode has been exited in this session, allowing prompts to be injected upon re-entry
        hasExitedPlanModeRef.current = true;
        setPermMode(prePlanMode);
        conversationRef.current.addSystemReminder(
          buildPlanModeExitReminder(planPath, !!planContent),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "Plan approved. Each edit requires confirmation.",
          },
        ]);
        if (planContent) {
          void handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "feedback" && feedback) {
        void handleSubmit(feedback);
      }
    },
    [workDir, prePlanMode],
  );

  const handleRewindAction = useCallback(
    (action: RewindAction) => {
      setRewindDialogActive(false);
      const fh = fileHistoryRef.current;
      if (!fh) {
        return;
      }

      switch (action.type) {
        case "code_and_conversation": {
          const changed = fh.rewind(action.snapshotIndex);
          const snap = rewindSnapshots[action.snapshotIndex];
          conversationRef.current.truncateTo(snap.messageIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound to checkpoint. Restored ${String(changed.length)} file(s) and conversation.${fileList}`,
            },
          ]);
          break;
        }
        case "conversation_only": {
          const snap = rewindSnapshots[action.snapshotIndex];
          conversationRef.current.truncateTo(snap.messageIndex);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound conversation. Files unchanged.`,
            },
          ]);
          break;
        }
        case "code_only": {
          const changed = fh.rewind(action.snapshotIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Restored ${String(changed.length)} file(s). Conversation unchanged.${fileList}`,
            },
          ]);
          break;
        }
        case "cancel":
          break;
      }
    },
    [rewindSnapshots],
  );

  const handleSubmit = async (text: string) => {
    // Save to prompt history
    historyMod.append(historyDir, text);
    setPromptHistory((prev) => [...prev, text]);

    // Handle slash commands
    if (text.startsWith("/")) {
      const handled = await handleSlashCommand(text);
      if (handled) {
        return;
      }
    }

    if (!clientRef.current) {
      setError("LLM client not ready yet");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // Inline any @file references for the model; the UI/session keep the
    // original text the user typed.
    conversationRef.current.addUserMessage(expandAtRefs(text, workDir));

    // Save to session
    sessionMod.saveMessage(workDir, sessionIdRef.current, {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });

    // If currently streaming, interrupt first
    if (isStreaming && abortControllerRef.current) {
      const partialText = streamingTextRef.current;
      abortControllerRef.current.abort();
      if (partialText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: partialText + "\n\n*[cancelled]*" },
        ]);
      }
      setMessages((prev) => [...prev, { role: "system", content: "(response interrupted)" }]);
    }

    streamStartRef.current = Date.now();
    setCompletionMark(null);
    setIsStreaming(true);
    setStreamingText("");
    setError(null);
    setActiveTools([]);

    try {
      await runAgentLoop();
    } catch (err) {
      const msg = asErrorString(err);
      const isAbort = strArg(asRecord(err), "name") === "AbortError" || msg.includes("abort");
      if (isAbort) {
        const partialText = streamingTextRef.current;
        if (partialText) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: partialText + "\n\n*[cancelled]*" },
          ]);
        }
        setMessages((prev) => [...prev, { role: "system", content: "(response interrupted)" }]);
      } else {
        setError(msg);
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      }
    } finally {
      const elapsed = Math.floor((Date.now() - streamStartRef.current) / 1000);
      setCompletionMark(`✻ ${randomCompletionVerb()} for ${String(elapsed)}s`);
      setIsStreaming(false);
      setActiveTools([]);
      abortControllerRef.current = null;
    }
  };

  const handleSubmitSync = (text: string) => {
    void handleSubmit(text);
  };

  if (appState === "providerSelect") {
    return <ProviderSelect providers={providers} onSelect={handleProviderSelect} />;
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" paddingTop={1} flexGrow={1}>
        <Box paddingLeft={1} flexDirection="column">
          <Text>
            {COLORS.primary(" /\\_/\\")} {"   "}
            {COLORS.primary("Larky")} <Text dimColor>v0.1.0</Text>
          </Text>
          <Text>
            {COLORS.primary("( o.o )")} {"  "}
            <Text dimColor>{selectedProvider.model || selectedProvider.name}</Text>
          </Text>
          <Text>
            {COLORS.primary(" > ^ <")} {"   "}
            <Text dimColor>{workDir}</Text>
          </Text>
        </Box>{" "}
        {/* Committed messages: rendered once by Ink's Static, never re-rendered.
            This eliminates flickering for the scrollback history. */}
        <Static
          items={messages
            .slice(0, committedIndexRef.current)
            .map((msg, i) => ({ ...msg, _key: i }))}
        >
          {(item) => <CommittedMessage key={item._key} message={item} expanded={toolsExpanded} />}
        </Static>
        {/* Active (non-committed) messages + streaming text: re-renders normally */}
        <ChatView
          messages={messages.slice(committedIndexRef.current)}
          streamingText={isStreaming ? streamingText : undefined}
          expanded={toolsExpanded}
        />
        {activeTools.length > 0 && <ToolDisplay tools={activeTools} />}
        {subagents.length > 0 && (
          <Box flexDirection="column" paddingLeft={1}>
            {subagents.map((s) => (
              <Text key={s.id} color="magenta">
                {ICONS.dot} {s.label} subagent · turn {s.turn}
                {s.lastTool ? ` · ${s.lastTool}` : ""}
              </Text>
            ))}
          </Box>
        )}
        {isStreaming && (
          <Box paddingLeft={1} flexDirection="column">
            <Spinner inputTokens={inputTokens} outputTokens={outputTokens} />
            {teammateStates.length > 0 && (
              <TeammateSpinnerTree
                teammates={teammateStates}
                leaderTokens={inputTokens + outputTokens}
              />
            )}
          </Box>
        )}
        {!isStreaming && teammateStates.some((t) => t.status === "running") && (
          <Box paddingLeft={1}>
            <TeammateSpinnerTree teammates={teammateStates} />
          </Box>
        )}
        {error && (
          <Box paddingLeft={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}{" "}
      </Box>

      {planApprovalActive && <PlanApprovalDialog onSelect={handlePlanApproval} />}

      {rewindDialogActive && (
        <RewindDialog
          snapshots={rewindSnapshots}
          onComplete={handleRewindAction}
          onCancel={() => {
            setRewindDialogActive(false);
          }}
        />
      )}

      {permissionRequest && (
        <PermissionDialog
          toolName={permissionRequest.toolName}
          argsSummary={permissionRequest.argsSummary}
          reason={permissionRequest.reason}
          onComplete={(action: PermissionAction) => {
            permissionResolveRef.current?.(action);
            permissionResolveRef.current = null;
            setPermissionRequest(null);
          }}
        />
      )}

      {askRequest && (
        <AskUserDialog
          questions={askRequest}
          onComplete={(answers) => {
            askResolveRef.current?.(answers);
            askResolveRef.current = null;
            setAskRequest(null);
          }}
        />
      )}

      {teamsDialogOpen && (
        <TeamsDialog
          teammates={teammateStates}
          onClose={() => {
            setTeamsDialogOpen(false);
          }}
          onKill={(name, teamName) => {
            const team = teamManagerRef.current.get(teamName);
            if (team) {
              void team.stopMember(name);
            }
          }}
          onShutdown={(name, teamName) => {
            const team = teamManagerRef.current.get(teamName);
            if (team) {
              void team.sendMessage("lead", name, "[shutdown] Please finish and exit");
            }
          }}
        />
      )}

      {!isStreaming && completionMark && (
        <Box paddingLeft={1}>
          <Text dimColor>{completionMark}</Text>
        </Box>
      )}
      <TeamStatus
        count={teammateStates.filter((t) => t.status === "running" || t.status === "idle").length}
      />
      <StatusBar
        model={selectedProvider.model}
        mode={permMode}
        inputTokens={inputTokens}
        outputTokens={outputTokens}
      />
      <InputBox
        onSubmit={handleSubmitSync}
        disabled={rewindDialogActive || permissionRequest !== null || askRequest !== null}
        history={promptHistory}
        commands={cmdRegistryRef.current.listCommands()}
        usageTracker={usageTrackerRef.current}
        inputState={
          error
            ? "error"
            : isStreaming || rewindDialogActive || permissionRequest
              ? "idle"
              : "focused"
        }
        permMode={permMode}
        onModeChange={(mode) => {
          setPermMode(mode);
        }}
        workDir={workDir}
        onEscape={() => {
          if (isStreaming) {
            abortControllerRef.current?.abort();
          }
        }}
      />
    </Box>
  );
}

// Compose the coordinator filter (active when teams exist) with an optional
// skill-based filter. Both must agree for a tool to be included. When no
// skill filter is set, only the coordinator filter is consulted.
function buildComposedToolFilter(
  coordinator: (name: string) => boolean,
  skillFilter: ((name: string) => boolean) | null,
): (name: string) => boolean {
  if (!skillFilter) {
    return coordinator;
  }
  return (name: string) => coordinator(name) && skillFilter(name);
}
