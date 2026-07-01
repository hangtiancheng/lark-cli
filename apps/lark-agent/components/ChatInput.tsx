"use client";
import { useState, useRef } from "react";
import type { Mode } from "@/hooks/useChat";

interface ChatInputProps {
  isStreaming: boolean;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
}

const MODES: Mode[] = ["quick", "stream"];

export default function ChatInput({
  isStreaming,
  mode,
  onModeChange,
  onSend,
  onUpload,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [showMode, setShowMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const t = text.trim();
    if (!t || isStreaming) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="relative rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        disabled={isStreaming}
        placeholder="Ask the lark-agent OnCall assistant"
        className="w-full resize-none bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-400"
        rows={1}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="relative">
          <button
            onClick={() => setShowTools((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
            aria-label="Tools"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
          </button>
          {showTools && (
            <div className="absolute bottom-full left-0 mb-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
              <button
                onClick={() => {
                  fileRef.current?.click();
                  setShowTools(false);
                }}
                className="flex w-48 items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-100"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>Upload file</span>
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowMode((v) => !v)}
              className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
            >
              <span>{mode === "quick" ? "Quick" : "Stream"}</span>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showMode && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                {MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      onModeChange(m);
                      setShowMode(false);
                    }}
                    className={`block w-40 rounded-lg px-3 py-2 text-left text-sm ${
                      m === mode ? "bg-sky-50 text-sky-600" : "text-zinc-800 hover:bg-zinc-100"
                    }`}
                  >
                    {m === "quick" ? "Quick" : "Stream"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={send}
            disabled={isStreaming || !text.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-zinc-100"
            aria-label="Send"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
