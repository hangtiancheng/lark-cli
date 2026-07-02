"use client";
import { useCallback } from "react";
import {
  useChat,
  type ChatMessage,
  type NotificationType,
} from "@/hooks/use-chat";
import Sidebar from "./sidebar";
import ChatContainer from "./chat-container";
import AIOpsBtn from "./ai-ops-btn";
import LoadingOverlay from "./loading-overlay";

const NOTIFY_COLORS: Record<NotificationType, string> = {
  info: "bg-sky-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export default function ChatApp() {
  const chat = useChat();

  const handleAIOps = useCallback(async () => {
    if (chat.isStreaming) {
      chat.showNotification(
        "Please wait for the current operation to finish",
        "warning",
      );
      return;
    }
    chat.newChat();
    const r = await chat.triggerAIOps();
    if (r) {
      const msg: ChatMessage = {
        type: "assistant",
        content: r.result,
        detail: r.detail,
      };
      chat.addMessage(msg);
    }
  }, [chat]);

  const handleUpload = useCallback(
    async (file: File) => {
      const msg = await chat.uploadFile(file);
      if (msg) chat.addMessage({ type: "assistant", content: msg });
    },
    [chat],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900">
      <Sidebar
        histories={chat.histories}
        activeId={chat.sessionId}
        onNewChat={chat.newChat}
        onLoad={chat.loadChatHistory}
        onDelete={chat.deleteChatHistory}
      />
      <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
        <AIOpsBtn onClick={handleAIOps} disabled={chat.isStreaming} />
        <ChatContainer
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          mode={chat.mode}
          onModeChange={chat.setMode}
          onSend={chat.sendMessage}
          onUpload={handleUpload}
        />
      </main>
      <LoadingOverlay overlay={chat.overlay} />
      {chat.notification && (
        <div
          className={`fixed right-5 top-5 z-10000 max-w-xs rounded-lg p-4 text-sm font-medium text-white shadow-lg ${
            NOTIFY_COLORS[chat.notification.type]
          }`}
        >
          {chat.notification.message}
        </div>
      )}
    </div>
  );
}
