import type { ChatAgent } from "../services/ai.js";
import type { SelectOption } from "../components/select-list.js";
import type { DocumentRetriever } from "../services/rag.js";
import type { ModelType, Session } from "../types.js";
import { saveSettings } from "../settings.js";
import * as storage from "../services/storage.js";
import { handleRagCommand } from "./rag-commands.js";
import { handleModelCommand, handleProviderCommand } from "./settings-commands.js";
import {
  createNewSession,
  deleteSessionCommand,
  listSessions,
  switchSession,
} from "./session-commands.js";

export interface CommandContext {
  currentSession: Session | null;
  retriever: DocumentRetriever | null;
  isStreaming: boolean;
  setCurrentSession: (session: Session | null) => void;
  setAgent: (agent: ChatAgent | null) => void;
  setMessages: (updater: (prev: DisplayMessage[]) => DisplayMessage[]) => void;
  setModel: (model: ModelType) => void;
  setIsStreaming: (value: boolean) => void;
  setRetriever: (retriever: DocumentRetriever | null) => void;
  setAppMode: (mode: "chat" | "codegen") => void;
  setCodegenPrompt: (prompt: string) => void;
  showNotification: (msg: string) => void;
  showSelect: (
    title: string,
    options: SelectOption[],
    defaultValue: string | undefined,
    onSelect: (value: string) => void,
  ) => void;
  createAgent: (sessionId: string, retriever: DocumentRetriever | null) => ChatAgent;
  exit: () => void;
}

export interface DisplayMessage {
  isUser: boolean;
  content: string;
  streaming?: boolean;
}

export function handleCommand(cmd: string, args: string, ctx: CommandContext): void {
  switch (cmd) {
    case "new":
    case "n": {
      const session = createNewSession(args || "New Chat");
      const newAgent = ctx.createAgent(session.id, ctx.retriever);
      ctx.setAgent(newAgent);
      ctx.setCurrentSession(session);
      ctx.setMessages(() => []);
      ctx.showNotification(`Created new session: ${session.title}`);
      break;
    }

    case "list":
    case "ls": {
      const result = listSessions(ctx.currentSession?.id ?? null);
      ctx.showNotification(result);
      break;
    }

    case "switch":
    case "sw": {
      if (!args) {
        ctx.showNotification("Usage: /switch <session-id-prefix or number>");
        break;
      }
      const target = switchSession(args);
      if (target) {
        const msgs = storage.getMessages(target.id);
        ctx.setMessages(() => msgs.map((m) => ({ isUser: m.isUser, content: m.content })));
        ctx.setCurrentSession(target);
        const newAgent = ctx.createAgent(target.id, ctx.retriever);
        ctx.setAgent(newAgent);
        ctx.showNotification(`Switched to: ${target.title}`);
      } else {
        ctx.showNotification(`Session not found: ${args}`);
      }
      break;
    }

    case "delete":
    case "del": {
      if (!args) {
        ctx.showNotification("Usage: /delete <session-id-prefix or number>");
        break;
      }
      const deleted = deleteSessionCommand(args);
      if (deleted) {
        if (ctx.currentSession?.id === deleted.id) {
          ctx.setCurrentSession(null);
          ctx.setAgent(null);
          ctx.setMessages(() => []);
        }
        ctx.showNotification(`Deleted session: ${deleted.title}`);
      } else {
        ctx.showNotification(`Session not found: ${args}`);
      }
      break;
    }

    case "sse": {
      ctx.setIsStreaming(!ctx.isStreaming);
      ctx.showNotification(`SSE streaming: ${!ctx.isStreaming ? "ON" : "OFF"}`);
      break;
    }

    case "rag": {
      if (!args) {
        ctx.showNotification("Usage: /rag <path1> [path2] [path3] ...");
        break;
      }
      void handleRagCommand(args, ctx);
      break;
    }

    case "clear":
    case "c": {
      ctx.setMessages(() => []);
      ctx.showNotification("Screen cleared.");
      break;
    }

    case "history":
    case "h": {
      if (!ctx.currentSession) {
        ctx.showNotification("No active session.");
        break;
      }
      const historyMsgs = storage.getMessages(ctx.currentSession.id);
      ctx.setMessages(() => historyMsgs.map((m) => ({ isUser: m.isUser, content: m.content })));
      ctx.showNotification(`Loaded ${historyMsgs.length} messages from history.`);
      break;
    }

    case "create-app": {
      if (!args) {
        ctx.showNotification("Usage: /create-app <description of the app you want to build>");
        break;
      }
      ctx.setCodegenPrompt(args);
      ctx.setAppMode("codegen");
      break;
    }

    case "provider": {
      handleProviderCommand(ctx);
      break;
    }

    case "model": {
      handleModelCommand(ctx);
      break;
    }

    case "help": {
      ctx.showNotification(
        [
          "Commands:",
          "  /new [title]      - Create new session",
          "  /list             - List all sessions",
          "  /switch <id|num>  - Switch session",
          "  /delete <id|num>  - Delete session",
          "  /sse              - Toggle SSE streaming mode",
          "  /rag <paths...>   - Upload files for RAG",
          "  /create-app <desc>- Generate a frontend app",
          "  /provider         - Select model provider",
          "  /model            - Select chat model",
          "  /history          - Reload chat history",
          "  /clear            - Clear screen",
          "  /exit             - Quit",
        ].join("\n"),
      );
      break;
    }

    case "exit":
    case "quit":
    case "q": {
      saveSettings();
      storage.closeDb();
      ctx.exit();
      break;
    }

    default: {
      ctx.showNotification(`Unknown command: /${cmd}. Type /help for available commands.`);
    }
  }
}
