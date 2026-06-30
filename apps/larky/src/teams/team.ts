import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FileMailbox } from "./file-mailbox.js";
import { detectBackend } from "./backend.js";
import type { TeammateUIState } from "./progress.js";
import { createProgress, recordToolUse, recordTokens } from "./progress.js";
import { randomVerb } from "../tui/verbs.js";
import type { ConversationManager } from "../conversation/conversation.js";
import { saveTranscript } from "./transcript.js";
import { asErrorString } from "@/utils/index.js";

export type TeamMode = "in-process" | "tmux" | "iterm";

// Callback that receives agent events during execution. The team layer uses
// this to update TeammateUIState without depending on the agent/LLM layer.
export type AgentEventCallback = (event: {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
  text?: string;
}) => void;

export interface Member {
  name: string;
  active: boolean;
  cancel?: () => void;
  mailbox: FileMailbox;
  uiState?: TeammateUIState;
  /** Optional: Conversation manager for the teammate; when set, the transcript is persisted on exit. */
  conversation?: ConversationManager;
}

// Runs a teammate's task and returns its final output. Injected so the team
// layer stays decoupled from the LLM/agent layer (and is unit-testable).
// The optional onEvent callback lets the team layer observe agent events
// (tool_use, usage) without coupling to the Agent/LLM types directly.
export type RunAgent = (task: string, onEvent?: AgentEventCallback) => Promise<string>;

export class Team {
  name: string;
  mode: TeamMode;
  members = new Map<string, Member>();
  leadMailbox: FileMailbox;
  private mailboxDir: string;
  private workDir: string;

  constructor(name: string, mode: TeamMode, workDir: string) {
    this.name = name;
    this.mode = mode;
    this.workDir = workDir;
    this.mailboxDir = join(workDir, ".larky", "teams", name);
    mkdirSync(this.mailboxDir, { recursive: true });
    this.leadMailbox = new FileMailbox(this.mailboxDir, "lead");
  }

  addMember(name: string): Member {
    const mailbox = new FileMailbox(this.mailboxDir, name);
    const member: Member = { name, active: false, mailbox };
    this.members.set(name, member);
    return member;
  }

  // Idle polling interval (in milliseconds). Polls the mailbox for new messages after a teammate completes a turn.
  static readonly IDLE_POLL_INTERVAL_MS = 500;
  // Shutdown prefix: the lead writes a message with this prefix to notify teammates to exit.
  static readonly SHUTDOWN_PREFIX = "[shutdown]";

  /**
   * Starts an in-process teammate: runs the agent's main loop in the background,
   * sends an idle notification upon completion, and then polls the mailbox for new tasks.
   * Exits the loop upon receiving a shutdown message or being canceled.
   */
  spawnTeammate(name: string, task: string, runAgent: RunAgent): void {
    const member = this.addMember(name);
    member.active = true;

    // Create UI state for progress tracking
    const uiState: TeammateUIState = {
      name,
      teamName: this.name,
      status: "running",
      progress: createProgress(),
      startTime: Date.now(),
      spinnerVerb: randomVerb(),
    };
    member.uiState = uiState;

    // Agent event callback: update progress
    const onEvent: AgentEventCallback = (event) => {
      switch (event.type) {
        case "tool_use":
          if (event.toolName && event.args) {
            recordToolUse(uiState.progress, event.toolName, event.args);
          }
          break;
        case "usage":
          if (event.usage) {
            recordTokens(uiState.progress, event.usage.inputTokens, event.usage.outputTokens);
          }
          break;
        case "stream_text":
          if (event.text) {
            uiState.lastMessage = event.text;
          }
          break;
      }
    };

    // Main loop: execute task → idle notification → poll mailbox → resume execution upon receiving new message
    void (async () => {
      let nextPrompt = task;
      let idleReason = "available";
      try {
        while (member.active) {
          // Execute one turn of the agent
          uiState.status = "running";
          const result = await runAgent(nextPrompt, onEvent);
          uiState.lastMessage = result.length > 200 ? result.slice(0, 200) + "..." : result;

          // Send idle notification to the lead
          uiState.status = "idle";
          await this.leadMailbox.send(name, `[idle] ${name} (reason: ${idleReason})`);
          idleReason = "available";

          // Poll mailbox for new messages or shutdown
          const pollResult = await this.waitForNextPromptOrShutdown(member);
          if (pollResult.shutdown) {
            break;
          }
          nextPrompt = pollResult.prompt;
        }

        uiState.status = "completed";
      } catch (e) {
        uiState.status = "failed";
        uiState.lastMessage = asErrorString(e);
        await this.leadMailbox.send(name, `[idle] ${name} (reason: failed)`);
      } finally {
        member.active = false;
        if (uiState.status === "running") {
          uiState.status = "idle";
        }
        // Persist conversation transcript on teammate exit for debugging
        if (member.conversation) {
          try {
            saveTranscript(this.workDir, this.name, name, member.conversation);
          } catch {
            // Best-effort: persistence failure should not block normal exit
          }
        }
      }
    })();
  }

  /**
   * Blocks until there is a new message in the teammate's mailbox.
   * Returns the concatenated prompt or a shutdown flag.
   */

  private async waitForNextPromptOrShutdown(
    member: Member,
  ): Promise<{ prompt: string; shutdown: boolean }> {
    while (member.active) {
      await new Promise((r) => setTimeout(r, Team.IDLE_POLL_INTERVAL_MS));
      const msgs = member.mailbox.receiveSync();
      if (msgs.length === 0) {
        continue;
      }

      // Check for a shutdown request
      const hasShutdown = msgs.some((m) => m.text.trimStart().startsWith(Team.SHUTDOWN_PREFIX));
      if (hasShutdown) {
        return { prompt: "", shutdown: true };
      }

      // Concatenate all messages to form the user prompt for the next turn
      const prompt = msgs.map((m) => `From ${m.from}: ${m.text}`).join("\n\n");
      return {
        prompt: `You have new messages from your team:\n\n${prompt}`,
        shutdown: false,
      };
    }
    return { prompt: "", shutdown: true };
  }

  getMember(name: string): Member | undefined {
    return this.members.get(name);
  }

  async sendMessage(from: string, to: string, content: string): Promise<void> {
    const member = this.members.get(to);
    if (!member) {
      throw new Error(`Member '${to}' not found in team '${this.name}'`);
    }
    await member.mailbox.send(from, content);
  }

  async stopMember(name: string): Promise<void> {
    const member = this.members.get(name);
    if (member) {
      member.active = false;
      if (member.uiState?.status === "running") {
        member.uiState.status = "stopped";
      }
      member.cancel?.();
    }
    return Promise.resolve();
  }

  async stopAll(): Promise<void> {
    for (const member of this.members.values()) {
      member.active = false;
      if (member.uiState?.status === "running") {
        member.uiState.status = "stopped";
      }
      member.cancel?.();
    }
    return Promise.resolve();
  }

  listMembers(): Member[] {
    return [...this.members.values()];
  }

  getTeammateStates(): TeammateUIState[] {
    return (
      this.listMembers()
        .filter((m) => m.uiState)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .map((m) => m.uiState!)
    );
  }
}

export class TeamManager {
  private teams = new Map<string, Team>();
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  create(name: string, mode: TeamMode = detectBackend()): Team {
    const team = new Team(name, mode, this.workDir);
    this.teams.set(name, team);
    return team;
  }

  get(name: string): Team | undefined {
    return this.teams.get(name);
  }

  list(): Team[] {
    return [...this.teams.values()];
  }

  async delete(name: string): Promise<void> {
    const team = this.teams.get(name);
    if (team) {
      await team.stopAll();
      this.teams.delete(name);
    }
  }

  getAllTeammateStates(): TeammateUIState[] {
    return this.list().flatMap((t) => t.getTeammateStates());
  }

  /**
   * Reads all unread messages from the team lead's mailbox and returns them in XML tag format.
   * This allows the model to parse team notifications in a structured manner.
   */
  drainLeads(): string[] {
    const out: string[] = [];
    for (const team of this.teams.values()) {
      const msgs = team.leadMailbox.receiveSync();
      if (msgs.length === 0) {
        continue;
      }
      const lines: string[] = [];
      lines.push(`<team-notification team="${team.name}">`);
      for (const msg of msgs) {
        lines.push(`from=${msg.from}: ${msg.text}`);
      }
      lines.push("</team-notification>");
      out.push(lines.join("\n"));
    }
    return out;
  }
}
