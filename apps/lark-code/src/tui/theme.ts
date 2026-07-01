// TUI color theme — Claude Code-inspired: warm amber accent on deep neutral background
// Minimal chrome, flowing text, compact inline indicators — no heavy box borders
export const theme = {
  // Primary palette — amber accent (Tailwind amber scale)
  accent: "#d4a017", // muted amber — softer than pure amber-500 for readability
  accentDim: "#92400e", // amber-800 — for separator lines
  accentBright: "#fbbf24", // amber-400 — for highlights only

  // Backgrounds (Tailwind neutral scale — true dark)
  bg: "#0a0a0a", // neutral-950
  bgPanel: "#141414", // slightly lighter than bg for subtle contrast
  bgInput: "#1a1a1a", // input area background
  bgSelected: "#262626", // neutral-800

  // Text hierarchy (Tailwind neutral scale)
  text: "#d4d4d4", // neutral-300 — primary content, slightly dimmer than pure white
  textBright: "#f5f5f5", // neutral-100 — only for key emphasis points
  textDim: "#737373", // neutral-500 — metadata, timestamps, labels
  textMuted: "#525252", // neutral-600 — decorative elements, progress bars

  // Semantic colors (Tailwind semantic palette)
  success: "#34d399", // emerald-400 — softer than pure green
  error: "#fb7185", // rose-400 — softer than pure red
  warning: "#fbbf24", // amber-400
  info: "#60a5fa", // blue-400

  // Tool call palette — inline, no borders
  toolName: "#d4a017", // same as accent for tool name inline
  toolRunning: "#fbbf24", // bright amber for spinner
  toolSuccess: "#34d399", // emerald for ✓
  toolFailed: "#fb7185", // rose for ✗

  // Subagent palette
  subagentAccent: "#a78bfa", // violet-400 — distinct from main accent
  subagentDim: "#7c3aed", // violet-600

  // Unicode indicators (Claude Code style — inline, no box borders)
  indicator: {
    runStart: "▶",
    runEnd: "■",
    step: "─",
    toolRunning: "⏺",
    toolSuccess: "✓",
    toolFailed: "✗",
    permission: "⚠",
    session: "●",
    subagent: "↳",
    compact: "↻",
    bullet: "•",
    arrow: "▸",
    dash: "╌",
    thinDash: "╎",
  },
} as const;

// Format a duration in milliseconds to a human-readable string
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

// Truncate a string to a maximum length, adding ellipsis if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// Context bar width in characters
const CONTEXT_BAR_WIDTH = 20;

// Render a context usage progress bar with color coding based on fill level
// Returns the bar string (caller applies color via Text component)
export function contextBarFill(pct: number): string {
  const clamped = Math.max(0, Math.min(1, pct));
  const filled = Math.round(clamped * CONTEXT_BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(CONTEXT_BAR_WIDTH - filled);
}

// Determine the color for a context percentage based on threshold
export function contextBarColor(pct: number): string {
  if (pct >= 0.85) return theme.error;
  if (pct >= 0.7) return theme.warning;
  return theme.textMuted;
}

// Format an ISO timestamp to a short HH:MM:SS string for inline display
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
