"use client";
import { useState, useRef } from "react";
import { MoreHorizontal, Paperclip, ChevronDown, Send } from "lucide-react";
import type { Mode } from "@/hooks/use-chat";

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
            <MoreHorizontal className="h-5 w-5" />
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
                <Paperclip className="h-5 w-5" />
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
              <ChevronDown className="h-4 w-4" />
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
                      m === mode
                        ? "bg-sky-50 text-sky-600"
                        : "text-zinc-800 hover:bg-zinc-100"
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
            <Send className="h-5 w-5" />
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
