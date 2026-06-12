import { useState, useEffect, useCallback, useRef } from "react";
import { useApp, useInput } from "ink";
import ChatView from "./components/chat-view.js";
import { CodegenView } from "./components/codegen/codegen-view.js";
import SelectList from "./components/select-list.js";
import type { SelectOption } from "./components/select-list.js";
import { ChatAgent } from "./services/ai.js";
import { ModelType } from "./types.js";
import type { Session } from "./types.js";
import * as storage from "./services/storage.js";
import type { DocumentRetriever } from "./services/rag.js";
import { handleCommand } from "./commands/command-handler.js";
import type { DisplayMessage } from "./commands/command-handler.js";
import { setActiveSessionId } from "./session-state.js";
import { inspectPrompt } from "./engine/ai/guardrails/prompt-safe-input.js";
import { createRateLimiter } from "./engine/rate-limit/index.js";
import { createInMemoryRateLimitStore } from "./engine/rate-limit/index.js";

const rateLimiter = createRateLimiter(createInMemoryRateLimitStore(), {
  namespace: "chat",
  maxRequests: 30,
  windowSeconds: 60,
});

type AppMode = "chat" | "codegen";

type SelectState = {
  title: string;
  options: SelectOption[];
  defaultValue?: string;
  onSelect: (value: string) => void;
} | null;

interface AppProps {
  sessionId?: string;
}

export default function App({ sessionId: initialSessionId }: AppProps) {
  const { exit } = useApp();
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [codegenPrompt, setCodegenPrompt] = useState<string>("");
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [agent, setAgent] = useState<ChatAgent | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [model, setModel] = useState<ModelType>(ModelType.OLLAMA);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const [notification, setNotification] = useState<string | null>(null);
  const [retriever, setRetriever] = useState<DocumentRetriever | null>(null);
  const [selectState, setSelectState] = useState<SelectState>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastCtrlCRef = useRef(0);
  const DOUBLE_PRESS_MS = 2000;

  useEffect(() => {
    storage.initDb();

    if (initialSessionId) {
      const session = storage.getSession(initialSessionId);
      if (session) {
        restoreSession(session);
      }
    }
  }, []);

  function restoreSession(session: Session): void {
    const historyMessages = storage.getMessages(session.id);
    const displayMsgs: DisplayMessage[] = historyMessages.map((m) => ({
      isUser: m.isUser,
      content: m.content,
    }));
    setMessages(displayMsgs);
    setCurrentSession(session);
    setActiveSessionId(session.id);

    const restoredAgent = new ChatAgent(session.id);
    restoredAgent.loadHistory(historyMessages);
    setAgent(restoredAgent);
  }

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const showSelect = useCallback(
    (
      title: string,
      options: SelectOption[],
      defaultValue: string | undefined,
      onSelect: (value: string) => void,
    ) => {
      setSelectState({ title, options, defaultValue, onSelect });
    },
    [],
  );

  const createAgentForSession = useCallback(
    (sid: string, ret: DocumentRetriever | null): ChatAgent => {
      const newAgent = new ChatAgent(sid);
      if (ret) newAgent.setRetriever(ret);
      return newAgent;
    },
    [],
  );

  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      const now = Date.now();
      if (now - lastCtrlCRef.current < DOUBLE_PRESS_MS) {
        storage.closeDb();
        exit();
        return;
      }
      lastCtrlCRef.current = now;

      if (loading) {
        handleAbort();
        showNotification("Output interrupted. Press Ctrl+C again to exit.");
      } else {
        showNotification("Press Ctrl+C again to exit.");
      }
    }
  });

  const handleSendMessage = useCallback(
    async (input: string) => {
      const check = inspectPrompt(input);
      if (!check.ok) {
        const msgs: Record<string, string> = {
          empty: "Input cannot be empty.",
          "too-long": "Input is too long. Please shorten your message.",
          sensitive: "Input contains restricted content.",
          injection: "Input contains a disallowed pattern.",
        };
        showNotification(msgs[check.reason] ?? "Invalid input.");
        return;
      }

      try {
        await rateLimiter.consume(currentSession?.id ?? "anonymous");
      } catch {
        showNotification("Too many requests. Please wait a moment.");
        return;
      }

      let activeAgent = agent;
      let activeSessionId = currentSession?.id;

      if (!activeAgent || !activeSessionId) {
        const session = storage.createSession(input.slice(0, 50));
        const newAgent = createAgentForSession(session.id, retriever);
        setAgent(newAgent);
        setCurrentSession(session);
        setActiveSessionId(session.id);
        activeAgent = newAgent;
        activeSessionId = session.id;
      }

      setMessages((prev) => [
        ...prev,
        { isUser: true, content: input },
        { isUser: false, content: "", streaming: isStreaming },
      ]);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let aiContent: string;

        if (isStreaming) {
          let streamContent = "";
          aiContent = await activeAgent.responseStream(
            input,
            (chunk) => {
              if (controller.signal.aborted) return;
              streamContent += chunk;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  isUser: false,
                  content: streamContent,
                  streaming: true,
                };
                return updated;
              });
            },
            controller.signal,
          );
        } else {
          aiContent = await activeAgent.response(input);
        }

        storage.saveMessage(activeSessionId, input, true);
        storage.saveMessage(activeSessionId, aiContent, false);

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            isUser: false,
            content: aiContent,
            streaming: false,
          };
          return updated;
        });
      } catch (err) {
        if (controller.signal.aborted) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              isUser: false,
              content: updated[updated.length - 1].content + "\n[interrupted]",
              streaming: false,
            };
            return updated;
          });
        } else {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              isUser: false,
              content: `Error: ${errMsg}`,
              streaming: false,
            };
            return updated;
          });
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    },
    [agent, currentSession, retriever, isStreaming, createAgentForSession, showNotification],
  );

  const onCommand = useCallback(
    (cmd: string, args: string) => {
      handleCommand(cmd, args, {
        currentSession,
        retriever,
        isStreaming,
        setCurrentSession: (session) => {
          setCurrentSession(session);
          setActiveSessionId(session?.id ?? null);
        },
        setAgent,
        setMessages,
        setModel,
        setIsStreaming,
        setRetriever,
        setAppMode,
        setCodegenPrompt,
        showNotification,
        showSelect,
        createAgent: createAgentForSession,
        exit: () => {
          storage.closeDb();
          exit();
        },
      });
    },
    [
      currentSession,
      retriever,
      isStreaming,
      createAgentForSession,
      showNotification,
      showSelect,
      exit,
    ],
  );

  if (selectState) {
    return (
      <SelectList
        title={selectState.title}
        options={selectState.options}
        defaultValue={selectState.defaultValue}
        onSelect={(value) => {
          selectState.onSelect(value);
          setSelectState(null);
        }}
        onCancel={() => setSelectState(null)}
      />
    );
  }

  if (appMode === "codegen") {
    return (
      <CodegenView
        prompt={codegenPrompt}
        onFinish={() => {
          setAppMode("chat");
          setCodegenPrompt("");
        }}
      />
    );
  }

  return (
    <ChatView
      sessionTitle={currentSession?.title ?? null}
      model={model}
      messages={messages}
      notification={notification}
      onSendMessage={handleSendMessage}
      onCommand={onCommand}
      loading={loading}
      streaming={isStreaming}
    />
  );
}
