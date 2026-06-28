/**
 * Keyboard input handler for Node.js terminal.
 * Manages stdin raw mode and parses ANSI escape sequences into
 * structured KeyEvent objects compatible with Ink's useInput API.
 *
 * Singleton pattern: one instance shared across all views.
 * Views subscribe/unsubscribe via on/off methods.
 */
import { stdin } from "process";
import type { KeyEvent, KeyboardHandler } from "./types.js";

/** Escape character */
const ESC = "\x1b";

/** ANSI escape sequence patterns for special keys */
const keyName: Record<string, string> = {
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[E": "clear",
  "[F": "end",
  "[H": "home",
  "[Z": "tab",
  "[1~": "home",
  "[2~": "insert",
  "[3~": "delete",
  "[4~": "end",
  "[5~": "pageup",
  "[6~": "pagedown",
  OP: "f1",
  OQ: "f2",
  OR: "f3",
  OS: "f4",
  "[15~": "f5",
  "[17~": "f6",
  "[18~": "f7",
  "[19~": "f8",
  "[20~": "f9",
  "[21~": "f10",
  "[23~": "f11",
  "[24~": "f12",
};

/** Create a default KeyEvent with all fields set to false/empty */
function createDefaultKey(): KeyEvent {
  return {
    input: "",
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    ctrl: false,
    shift: false,
    meta: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
  };
}

/** Parse a raw stdin string into a KeyEvent */
export function parseKeypress(s: string): KeyEvent {
  const key = createDefaultKey();

  if (!s) {
    return key;
  }

  // Kitty keyboard protocol: CSI codepoint ; modifiers [: eventType] u
  const kittyMatch = /^\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?u$/.exec(s);
  if (kittyMatch) {
    const codepoint = parseInt(kittyMatch[1], 10);
    const modifiers = kittyMatch[2] ? Math.max(0, parseInt(kittyMatch[2], 10) - 1) : 0;

    key.ctrl = !!(modifiers & 4);
    key.shift = !!(modifiers & 1);
    key.meta = !!(modifiers & 2);

    if (codepoint === 13) {
      key.return = true;
    } else if (codepoint === 27) {
      key.escape = true;
    } else if (codepoint === 9) {
      key.tab = true;
    } else if (codepoint === 127 || codepoint === 8) {
      key.backspace = true;
    } else if (codepoint === 32) {
      key.input = " ";
    } else if (codepoint >= 1 && codepoint <= 26) {
      key.ctrl = true;
      key.input = String.fromCodePoint(codepoint + 96);
    } else {
      key.input = String.fromCodePoint(codepoint);
    }
    return key;
  }

  if (s === "\r" || s === "\x1b\r") {
    key.return = true;
    key.meta = s.length === 2;
    return key;
  }

  if (s === "\n") {
    key.return = true;
    return key;
  }

  if (s === "\t") {
    key.tab = true;
    return key;
  }

  if (s === "\b" || s === "\x7f" || s === "\x1b\x7f" || s === "\x1b\b") {
    key.backspace = true;
    key.meta = s.startsWith(ESC);
    return key;
  }

  if (s === ESC || s === ESC + ESC) {
    key.escape = true;
    key.meta = s.length === 2;
    return key;
  }

  if (s === " " || s === "\x1b ") {
    key.input = " ";
    key.meta = s.length === 2;
    return key;
  }

  if (s.length === 1 && s.charCodeAt(0) <= 26) {
    key.ctrl = true;
    key.input = String.fromCharCode(s.charCodeAt(0) + "a".charCodeAt(0) - 1);
    return key;
  }

  // ANSI escape sequences (arrows, function keys, etc.)
  const fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
  const parts = fnKeyRe.exec(s);
  if (parts) {
    const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join("");
    const modifier = (Number(parts[3]) || Number(parts[5]) || 1) - 1;

    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 10);
    key.shift = !!(modifier & 1);

    const name = keyName[code];
    if (name === "up") {
      key.upArrow = true;
    } else if (name === "down") {
      key.downArrow = true;
    } else if (name === "left") {
      key.leftArrow = true;
    } else if (name === "right") {
      key.rightArrow = true;
    } else if (name === "pageup") {
      key.pageUp = true;
    } else if (name === "pagedown") {
      key.pageDown = true;
    } else if (name === "home") {
      key.home = true;
    } else if (name === "end") {
      key.end = true;
    } else if (name === "delete") {
      key.delete = true;
    } else if (name === "tab") {
      key.tab = true;
      key.shift = true;
    }
    return key;
  }

  const metaRe = /^(?:\x1b)([a-zA-Z0-9])$/;
  const metaParts = metaRe.exec(s);
  if (metaParts) {
    key.meta = true;
    key.input = metaParts[1].toLowerCase();
    key.shift = /^[A-Z]$/.test(metaParts[1]);
    return key;
  }

  if (s.length === 1 && s >= "A" && s <= "Z") {
    key.input = s.toLowerCase();
    key.shift = true;
    return key;
  }

  if (s.length === 1) {
    key.input = s;
    return key;
  }

  return key;
}

/** Keyboard input singleton */
class KeyboardInputManager {
  private handlers = new Set<KeyboardHandler>();
  private rawMode = false;
  private onData: ((data: string) => void) | null = null;

  /** Subscribe to keyboard events */
  on(handler: KeyboardHandler): () => void {
    this.handlers.add(handler);
    if (this.handlers.size === 1) {
      this.enableRawMode();
    }
    return () => {
      this.off(handler);
    };
  }

  /** Unsubscribe from keyboard events */
  off(handler: KeyboardHandler): void {
    this.handlers.delete(handler);
    if (this.handlers.size === 0) {
      this.disableRawMode();
    }
  }

  /** Enable raw mode on stdin */
  private enableRawMode(): void {
    if (this.rawMode || !stdin.isTTY) {
      return;
    }
    this.rawMode = true;
    stdin.setEncoding("utf8");
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    this.onData = (data: string) => {
      const key = parseKeypress(data);
      for (const handler of this.handlers) {
        handler(key.input, key);
      }
    };
    stdin.on("data", this.onData);
  }

  /** Disable raw mode on stdin */
  private disableRawMode(): void {
    if (!this.rawMode) {
      return;
    }
    this.rawMode = false;
    if (this.onData) {
      stdin.off("data", this.onData);
      this.onData = null;
    }
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
    stdin.pause();
  }

  /** Whether raw mode is currently active */
  get isActive(): boolean {
    return this.rawMode;
  }
}

/** Singleton keyboard input manager */
export const keyboard = new KeyboardInputManager();
