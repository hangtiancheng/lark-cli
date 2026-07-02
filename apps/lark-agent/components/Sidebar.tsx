"use client";
import type { ChatHistory } from "@/hooks/use-chat";

interface SidebarProps {
  histories: ChatHistory[];
  activeId: string;
  onNewChat: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  histories,
  activeId,
  onNewChat,
  onLoad,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="flex w-60 flex-col border-r border-zinc-200 bg-sky-50">
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-base font-medium text-zinc-800">lark-agent</h2>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <button
          onClick={onNewChat}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          <span>New chat</span>
        </button>
        <div className="mt-4 flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent
          </div>
          <div className="flex flex-col gap-1">
            {histories.map((h) => (
              <div
                key={h.id}
                className={`group flex items-center rounded-lg px-3 py-2 transition hover:bg-zinc-100 ${
                  h.id === activeId ? "bg-zinc-100" : ""
                }`}
              >
                <button
                  onClick={() => onLoad(h.id)}
                  className="flex-1 truncate text-left text-sm text-zinc-800"
                >
                  {h.title}
                </button>
                <button
                  onClick={() => onDelete(h.id)}
                  className="ml-2 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
