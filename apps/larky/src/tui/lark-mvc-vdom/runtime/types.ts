/**
 * Core types for the lark-mvc terminal UI runtime.
 * These types define the minimal view context and event system
 * needed for Node.js terminal rendering without browser APIs.
 */
import type { VDomNode, EmitterApi, ChangeEvent } from "@lark.js/mvc";

/** Structured keyboard event from stdin raw mode */
export interface KeyEvent {
  /** Raw input character (empty for special keys) */
  input: string;
  /** Arrow up key pressed */
  upArrow: boolean;
  /** Arrow down key pressed */
  downArrow: boolean;
  /** Arrow left key pressed */
  leftArrow: boolean;
  /** Arrow right key pressed */
  rightArrow: boolean;
  /** Return/Enter key pressed */
  return: boolean;
  /** Escape key pressed */
  escape: boolean;
  /** Tab key pressed */
  tab: boolean;
  /** Backspace key pressed */
  backspace: boolean;
  /** Delete key pressed */
  delete: boolean;
  /** Ctrl modifier held */
  ctrl: boolean;
  /** Shift modifier held */
  shift: boolean;
  /** Meta/Alt modifier held */
  meta: boolean;
  /** Page Up key pressed */
  pageUp: boolean;
  /** Page Down key pressed */
  pageDown: boolean;
  /** Home key pressed */
  home: boolean;
  /** End key pressed */
  end: boolean;
}

/** Context for a terminal view instance */
export interface TerminalViewCtx {
  /** Unique view ID */
  id: string;
  /** View-local data store (replaces updater.data) */
  data: Record<string, unknown>;
  /** Lifecycle guard: >0 means active, 0 means destroyed */
  signature: { value: number };
  /** Event emitter for lifecycle events */
  emitter: EmitterApi;
  /** Cleanup functions to run on destroy */
  cleanups: (() => void)[];
  /** Subscribe to a lifecycle event */
  on(event: string, handler: (e?: ChangeEvent) => void): () => void;
  /** Fire a lifecycle event */
  fire(event: string, data?: Record<string, unknown>): void;
  /** Merge data into the view's data store and trigger re-render */
  setData(patch: Record<string, unknown>): void;
  /** Get a value from the view's data store */
  getData(key: string): unknown;
  /** Whether the view has been rendered at least once */
  rendered: { value: boolean };
  /** Set the render callback */
  setRenderCallback?(cb: (data: Record<string, unknown>) => VDomNode): void;
  /** Trigger a render */
  doRender?(): void;
}

/** Setup function for a terminal view */
export type TerminalViewSetup = (
  ctx: TerminalViewCtx,
  props?: Record<string, unknown>,
) => TerminalViewResult;

/** Result returned by a terminal view setup function */
export interface TerminalViewResult {
  /** Render function: called on each data change, returns a VDomNode tree */
  render: (data: Record<string, unknown>) => VDomNode;
  /** Optional event handlers (currently unused in terminal mode) */
  events?: Record<string, (...args: unknown[]) => void>;
}

/** Render context passed through VDomNode tree during ANSI conversion */
export interface RenderContext {
  /** Terminal width in columns */
  width: number;
  /** Accumulated text styles */
  styles: TextStyle;
  /** Current indentation level (for nested blocks) */
  indent: number;
}

/** Text styling state accumulated during tree traversal */
export interface TextStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  /** Foreground color name or hex */
  color: string | null;
  /** Background color name or hex */
  backgroundColor: string | null;
}

/** Box-drawing character set for borders */
export interface BoxChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

/** Keyboard event handler function type */
export type KeyboardHandler = (input: string, key: KeyEvent) => void;
