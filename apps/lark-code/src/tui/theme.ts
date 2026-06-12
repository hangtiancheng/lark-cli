// TUI color theme — aligned with Tailwind CSS color palette
export const theme = {
  // Primary palette — amber accent (Tailwind amber scale)
  accent: "#f59e0b", // amber-500
  accentDim: "#b45309", // amber-700
  accentBright: "#fbbf24", // amber-400

  // Backgrounds (Tailwind neutral scale)
  bg: "#0a0a0a", // neutral-950
  bgPanel: "#171717", // neutral-900
  bgInput: "#171717", // neutral-900
  bgSelected: "#262626", // neutral-800

  // Text hierarchy (Tailwind neutral scale)
  text: "#e5e5e5", // neutral-200
  textDim: "#737373", // neutral-500
  textMuted: "#404040", // neutral-700

  // Semantic colors (Tailwind semantic palette)
  success: "#4ade80", // green-400
  error: "#f87171", // red-400
  warning: "#fbbf24", // amber-400
  info: "#60a5fa", // blue-400

  // Tool call palette
  toolBg: "#171717", // neutral-900
  toolBorder: "#262626", // neutral-800
  toolProgress: "#f59e0b", // amber-500

  // Box-drawing characters for borders
  border: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    cross: "┼",
    teeLeft: "┤",
    teeRight: "├",
    teeUp: "┴",
    teeDown: "┬",
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
