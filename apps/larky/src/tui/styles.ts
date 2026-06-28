import chalk from "chalk";

export const COLORS = {
  primary: chalk.hex("#42b883"),
  white: chalk.bold.white,
  dim: chalk.dim,
  black: chalk.black,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.bold.red,
  muted: chalk.gray,
  thinking: chalk.hex("#42b883ee"),
  tool: chalk.cyan,
  user: chalk.bold.blue,
  assistant: chalk.bold.hex("#42b883"),
} as const;

export const ICONS = {
  prompt: ">",
  thinking: "✻",
  tool: "⏺",
  success: "✓",
  error: "✗",
  arrow: "→" satisfies "→" | "←",
  dot: "·",
} as const;

export const CMD_COLORS = {
  local: "⚙",
  local_ui: "⚙",
  skill_fork: "★",
  prompt: "◇",
} as const;

export const BORDER_COLORS = {
  idle: "gray",
  focused: "gray",
  agent: "#a855f6",
  error: "red",
} as const;
