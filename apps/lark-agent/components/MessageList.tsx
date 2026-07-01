"use client";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useChat";
import MarkdownRenderer from "./MarkdownRenderer";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-6 py-4">
      {messages.map((m, i) => (
        <MessageItem
          key={i}
          message={m}
          streaming={isStreaming && i === messages.length - 1 && m.type === "assistant"}
        />
      ))}
    </div>
  );
}

function MessageItem({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.type === "user") {
    return (
      <div className="mb-6 flex flex-col items-end">
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-green-500">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="white">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        {message.detail && message.detail.length > 0 && (
          <details className="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-sky-600">
              View details ({message.detail.length} steps)
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {message.detail.map((d, idx) => (
                <div
                  key={idx}
                  className="border-l-2 border-sky-400 bg-white p-2 text-xs text-zinc-700"
                >
                  <strong className="text-sky-600">Step {idx + 1}:</strong> {d}
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="text-sm text-zinc-800">
          <MarkdownRenderer content={message.content} />
          {streaming && <span className="ml-1 animate-pulse text-sky-500">▋</span>}
        </div>
      </div>
    </div>
  );
}
