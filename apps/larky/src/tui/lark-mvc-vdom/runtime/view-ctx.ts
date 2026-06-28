/**
 * Minimal terminal view context for Node.js.
 *
 * Provides the same hook patterns as lark-mvc's hooks.ts but without
 * browser dependencies. Uses a module-level currentCtx variable that
 * is set during view setup execution (same pattern as lark-mvc).
 *
 * Reuses from lark-mvc: createEmitter, createStore, computed, mark/unmark.
 */
import { createEmitter, createStore, computed } from "@lark.js/mvc";
import type { ChangeEvent, VDomNode } from "@lark.js/mvc";
import type {
  TerminalViewCtx,
  TerminalViewSetup,
  TerminalViewResult,
  KeyboardHandler,
} from "./types.js";
import { keyboard } from "./keyboard-input.js";
import { renderToANSI, createRenderContext } from "./terminal-renderer.js";
import { renderFrame, getTerminalWidth } from "./terminal-output.js";
import { asRecord } from "@/utils/index.js";

// ============================================================
// Module-level current context (set during setup execution)
// ============================================================

let currentCtx: TerminalViewCtx | null = null;

/** Set the current ctx (called before running setup) */
export function setCurrentCtx(ctx: TerminalViewCtx | null): void {
  currentCtx = ctx;
}

/** Get the current ctx (throws if called outside setup) */
function getCtx(): TerminalViewCtx {
  if (!currentCtx) {
    throw new Error("Hooks can only be called inside a terminal view setup function");
  }
  return currentCtx;
}

// ============================================================
// Hooks
// ============================================================

/**
 * View-local state backed by ctx.data.
 * Returns a [getter, setter] pair. The getter reads the latest value.
 * Single signature (no overloads) — callers narrow via typeof on the value.
 */
export function tuiUseState(
  key: string,
  initial: string | number | boolean,
): [() => string | number | boolean, (v: string | number | boolean) => void] {
  const ctx = getCtx();
  if (ctx.data[key] === undefined) {
    ctx.data[key] = initial;
  }
  const getter = (): string | number | boolean => {
    const value = ctx.data[key];
    if (
      (typeof initial === "string" && typeof value === "string") ||
      (typeof initial === "number" && typeof value === "number") ||
      (typeof initial === "boolean" && typeof value === "boolean")
    ) {
      return value;
    }
    return initial;
  };
  const setter = (v: string | number | boolean): void => {
    ctx.setData({ [key]: v });
  };
  return [getter, setter];
}

/**
 * Register a side effect with cleanup.
 * Runs immediately during setup (same as lark-mvc's useEffect).
 * The returned cleanup function runs on destroy.
 */
export function tuiUseEffect(fn: () => () => void, _deps?: unknown[]): void {
  const ctx = getCtx();
  const cleanup = fn();
  if (typeof cleanup === "function") {
    ctx.cleanups.push(cleanup);
  }
}

/** Minimal store shape — getState + subscribe (no destroy required) */
interface SubscribableStore<T> {
  getState(): T;
  subscribe(listener: (state: T, prevState: T) => void): () => void;
}

/**
 * Subscribe a store to the view. When the store changes,
 * the selector result is merged into ctx.data and triggers re-render.
 */
export function tuiUseStore<T>(
  store: SubscribableStore<T>,
  selector?: (s: T) => Record<string, unknown>,
): void {
  const ctx = getCtx();
  const defaultSelector = (s: T): Record<string, unknown> => {
    if (s && typeof s === "object" && !Array.isArray(s)) {
      return asRecord(s);
    }
    return {};
  };
  const extract = selector ?? defaultSelector;

  // Initial sync
  const state = store.getState();
  const initial = extract(state);
  ctx.setData(initial);

  // Subscribe to changes
  const off = store.subscribe((newState) => {
    const data = extract(newState);
    ctx.setData(data);
  });

  ctx.cleanups.push(off);
}

/**
 * Auto-cleaning interval. Runs fn every ms milliseconds.
 * Cleaned up when the view is destroyed.
 */
export function tuiUseInterval(fn: () => void, ms: number): void {
  tuiUseEffect(() => {
    const timer = setInterval(fn, ms);
    return () => {
      clearInterval(timer);
    };
  }, []);
}

/**
 * Subscribe to keyboard events for the lifetime of the view.
 */
export function tuiUseKeyboard(handler: KeyboardHandler): void {
  tuiUseEffect(() => {
    const off = keyboard.on(handler);
    return off;
  }, []);
}

// ============================================================
// View lifecycle
// ============================================================

// Internal interface for the full context with render methods
interface TerminalViewCtxInternal extends TerminalViewCtx {
  setRenderCallback(cb: (data: Record<string, unknown>) => VDomNode): void;
  doRender(): void;
}

let viewIdCounter = 0;

/** Create a terminal view context */
export function createTerminalCtx(): TerminalViewCtxInternal {
  const id = `tui-${String(++viewIdCounter)}`;
  const data: Record<string, unknown> = {};
  const signature = { value: 0 };
  const rendered = { value: false };
  const emitter = createEmitter();
  const cleanups: (() => void)[] = [];

  // Render callback: called when data changes
  let renderCallback: ((data: Record<string, unknown>) => VDomNode) | null = null;

  function on(event: string, handler: (e?: ChangeEvent) => void): () => void {
    emitter.on(event, handler);
    return () => emitter.off(event, handler);
  }

  function fire(event: string, eventData?: Record<string, unknown>): void {
    emitter.fire(event, eventData);
  }

  function setData(patch: Record<string, unknown>): void {
    // Merge patch into data
    for (const key of Object.keys(patch)) {
      data[key] = patch[key];
    }
    // Trigger re-render if render callback is set
    if (renderCallback && signature.value > 0) {
      doRender();
    }
  }

  function getData(key: string): unknown {
    return data[key];
  }

  function doRender(): void {
    if (!renderCallback || signature.value <= 0) {
      return;
    }
    try {
      const vnode = renderCallback(data);
      const ctx = createRenderContext(getTerminalWidth());
      const ansi = renderToANSI(vnode, ctx);
      renderFrame(ansi);
      rendered.value = true;
    } catch (e) {
      console.error("[TUI] Render error:", e);
    }
  }

  const ctx: TerminalViewCtx & {
    setRenderCallback: (cb: (data: Record<string, unknown>) => VDomNode) => void;
    doRender: () => void;
  } = {
    id,
    data,
    signature,
    rendered,
    emitter,
    cleanups,
    on,
    fire,
    setData,
    getData,
    setRenderCallback(cb: (data: Record<string, unknown>) => VDomNode) {
      renderCallback = cb;
    },
    doRender,
  };

  return ctx;
}

/** Mount a terminal view: create ctx, run setup, trigger first render */
export function mountTerminalView(
  setup: TerminalViewSetup,
  props?: Record<string, unknown>,
): TerminalViewCtxInternal {
  const ctx = createTerminalCtx();

  // Set current ctx for hooks
  setCurrentCtx(ctx);

  try {
    // Run setup function
    const result = setup(ctx, props);

    // Wire up render callback
    ctx.setRenderCallback(result.render);

    // Activate signature
    ctx.signature.value = 1;

    // Trigger first render
    ctx.doRender();
  } finally {
    setCurrentCtx(null);
  }

  return ctx;
}

/** Unmount a terminal view: run cleanups, zero signature */
export function unmountTerminalView(ctx: TerminalViewCtx): void {
  // Run cleanups in reverse order
  for (let i = ctx.cleanups.length - 1; i >= 0; i--) {
    try {
      ctx.cleanups[i]();
    } catch (e) {
      console.error("[TUI] Cleanup error:", e);
    }
  }
  ctx.cleanups.length = 0;

  // Fire destroy event
  ctx.fire("destroy");

  // Zero signature
  ctx.signature.value = 0;
}

// ============================================================
// defineTerminalView
// ============================================================

/**
 * Define a terminal view via a setup function.
 * The setup function runs once, receives a TerminalViewCtx, and returns
 * a render function that produces a VDomNode tree on each data change.
 */
export function defineTerminalView(
  setup: (
    ctx: TerminalViewCtx,
    props?: Record<string, unknown>,
  ) => (data: Record<string, unknown>) => VDomNode,
): TerminalViewSetup {
  return (ctx: TerminalViewCtx, props?: Record<string, unknown>): TerminalViewResult => {
    const render = setup(ctx, props);
    return { render };
  };
}

// ============================================================
// Re-exports for convenience
// ============================================================

export { createStore, computed };
