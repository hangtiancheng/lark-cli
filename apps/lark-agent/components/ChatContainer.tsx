"use client";
import type { ChatMessage, Mode } from "@/hooks/useChat";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";

interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
}

export default function ChatContainer({
  messages,
  isStreaming,
  mode,
  onModeChange,
  onSend,
  onUpload,
}: ChatContainerProps) {
  const centered = messages.length === 0;
  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden ${
        centered ? "items-center justify-center" : ""
      }`}
    >
      {centered ? (
        <div className="px-6 text-center text-sky-600">
          <p className="text-2xl">Hello! I am the lark-agent OnCall assistant</p>
          <p className="mt-3 text-sm text-zinc-500">
            If this is your first time, upload a file from the docs directory via the
            &quot;...&quot; menu before chatting, otherwise you may get a search error.
          </p>
        </div>
      ) : (
        <MessageList messages={messages} isStreaming={isStreaming} />
      )}
      <div className="w-full max-w-3xl px-5 pb-5">
        <ChatInput
          isStreaming={isStreaming}
          mode={mode}
          onModeChange={onModeChange}
          onSend={onSend}
          onUpload={onUpload}
        />
      </div>
    </div>
  );
}
