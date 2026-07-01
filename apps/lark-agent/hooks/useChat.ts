"use client";
import { useState, useCallback, useEffect, useRef } from "react";

export type Mode = "quick" | "stream";

export interface ChatMessage {
  type: "user" | "assistant";
  content: string;
  /** Optional step details for AI Ops results. */
  detail?: string[];
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AIOpsResult {
  result: string;
  detail: string[];
}

export type NotificationType = "info" | "success" | "warning" | "error";

interface OverlayState {
  show: boolean;
  text: string;
  subtext: string;
}

const MAX_HISTORIES = 50;
const STORAGE_KEY = "lark-agent-chatHistories";

function generateSessionId(): string {
  return "session_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
}

function loadHistories(): ChatHistory[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as ChatHistory[]) : [];
  } catch {
    return [];
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.type === "user");
  if (!firstUser) return "New chat";
  const c = firstUser.content;
  return c.slice(0, 30) + (c.length > 30 ? "..." : "");
}

export function useChat() {
  const [mode, setMode] = useState<Mode>("quick");
  const [sessionId, setSessionId] = useState<string>(generateSessionId);
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [histories, setHistories] = useState<ChatHistory[]>(loadHistories);
  const [isFromHistory, setIsFromHistory] = useState(false);
  const [notification, setNotification] = useState<{
    message: string;
    type: NotificationType;
  } | null>(null);
  const [overlay, setOverlay] = useState<OverlayState>({
    show: false,
    text: "",
    subtext: "",
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = useCallback((message: string, type: NotificationType = "info") => {
    setNotification({ message, type });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  // Persist histories to localStorage whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch {
      // ignore quota errors
    }
  }, [histories]);

  // Upsert the current conversation into histories (called after a turn).
  const upsertHistory = useCallback((sid: string, msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    setHistories((prev) => {
      const title = deriveTitle(msgs);
      const now = new Date().toISOString();
      const idx = prev.findIndex((h) => h.id === sid);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          messages: msgs,
          title,
          updatedAt: now,
        };
        return updated;
      }
      return [{ id: sid, title, messages: msgs, createdAt: now, updatedAt: now }, ...prev].slice(
        0,
        MAX_HISTORIES,
      );
    });
  }, []);

  const newChat = useCallback(() => {
    if (isStreaming) {
      showNotification(
        "Please wait for the current chat to finish before starting a new one",
        "warning",
      );
      return;
    }
    setMessages([]);
    setSessionId(generateSessionId());
    setIsFromHistory(false);
  }, [isStreaming, showNotification]);

  const loadChatHistory = useCallback(
    (id: string) => {
      const h = histories.find((x) => x.id === id);
      if (!h) return;
      setSessionId(h.id);
      setMessages(h.messages);
      setIsFromHistory(true);
    },
    [histories],
  );

  const deleteChatHistory = useCallback(
    (id: string) => {
      setHistories((prev) => prev.filter((h) => h.id !== id));
      if (sessionId === id) {
        setMessages([]);
        setSessionId(generateSessionId());
        setIsFromHistory(false);
      }
    },
    [sessionId],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || isStreaming) return;
      setMessages((prev) => [...prev, { type: "user", content: text }]);
      setIsStreaming(true);

      try {
        if (mode === "quick") {
          const resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sessionId, question: text }),
          });
          const data = (await resp.json()) as {
            message: string;
            data?: { answer?: string };
          };
          if (data.message === "OK" && data.data?.answer) {
            setMessages((prev) => [...prev, { type: "assistant", content: data.data!.answer! }]);
          } else {
            throw new Error(data.message || "Unknown error");
          }
        } else {
          const resp = await fetch("/api/chat_stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sessionId, question: text }),
          });
          const reader = resp.body?.getReader();
          if (!reader) throw new Error("no stream body");
          const decoder = new TextDecoder();
          let buffer = "";
          let full = "";
          let currentEvent = "";
          setMessages((prev) => [...prev, { type: "assistant", content: "" }]);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("id: ")) continue;
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7);
                continue;
              }
              if (line.startsWith("data: ")) {
                const d = line.slice(6);
                if (currentEvent === "message") {
                  full += d === "" ? "\n" : d;
                  setMessages((prev) => {
                    const next = [...prev];
                    next[next.length - 1] = {
                      type: "assistant",
                      content: full,
                    };
                    return next;
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) => [...prev, { type: "assistant", content: "Error: " + msg }]);
      } finally {
        setIsStreaming(false);
        setMessages((prev) => {
          upsertHistory(sessionId, prev);
          return prev;
        });
      }
    },
    [isStreaming, mode, sessionId, upsertHistory],
  );

  const triggerAIOps = useCallback(async (): Promise<AIOpsResult | null> => {
    setIsStreaming(true);
    setOverlay({
      show: true,
      text: "AI Ops analyzing...",
      subtext: "Backend processing, please wait",
    });
    try {
      const resp = await fetch("/api/ai_ops", { method: "POST" });
      const data = (await resp.json()) as {
        message: string;
        data?: { result?: string; detail?: string[] };
      };
      if (data.message === "OK" && data.data?.result) {
        return {
          result: data.data.result,
          detail: data.data.detail ?? [],
        };
      }
      throw new Error(data.message || "Unknown error");
    } catch (e) {
      showNotification("AI Ops failed: " + (e instanceof Error ? e.message : String(e)), "error");
      return null;
    } finally {
      setIsStreaming(false);
      setOverlay({ show: false, text: "", subtext: "" });
    }
  }, [showNotification]);

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      const allowed = [".txt", ".md", ".markdown"];
      const name = file.name.toLowerCase();
      if (!allowed.some((ext) => name.endsWith(ext))) {
        showNotification("Only TXT or Markdown (.md) files are supported", "error");
        return null;
      }
      if (file.size > 50 * 1024 * 1024) {
        showNotification("File size must not exceed 50MB", "error");
        return null;
      }
      setIsStreaming(true);
      setOverlay({ show: true, text: "Uploading file...", subtext: file.name });
      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch("/api/upload", { method: "POST", body: fd });
        const data = (await resp.json()) as { message: string; data?: unknown };
        if (data.message === "OK" && data.data) {
          return `${file.name} uploaded to knowledge base`;
        }
        throw new Error(data.message || "Upload failed");
      } catch (e) {
        showNotification("Upload failed: " + (e instanceof Error ? e.message : String(e)), "error");
        return null;
      } finally {
        setIsStreaming(false);
        setOverlay({ show: false, text: "", subtext: "" });
      }
    },
    [showNotification],
  );

  return {
    mode,
    setMode,
    sessionId,
    isStreaming,
    messages,
    addMessage: (msg: ChatMessage) => setMessages((prev) => [...prev, msg]),
    histories,
    isFromHistory,
    notification,
    overlay,
    showNotification,
    newChat,
    loadChatHistory,
    deleteChatHistory,
    sendMessage,
    triggerAIOps,
    uploadFile,
  };
}
