/**
 * Simple zustand-like store for terminal views.
 *
 * Re-exports lark-mvc's createStore for views that need the full API
 * (computed, actions). Provides createSimpleStore for the common case
 * of a plain state object with setState/getState/subscribe.
 */
export { createStore } from "@lark.js/mvc";
export type { StoreApi } from "@lark.js/mvc";

type Listener<T> = (state: T, prevState: T) => void;

interface SimpleStoreApi<T> {
  getState: () => T;
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void;
  subscribe: (listener: Listener<T>) => () => void;
}

/**
 * Create a minimal store from a plain initial state object.
 * All own-enumerable properties of the initial object become mutable state.
 * Functions on the initial object are treated as actions (not tracked for change).
 */
export function createSimpleStore<T extends object>(initial: T): SimpleStoreApi<T> {
  let state: T = { ...initial };
  const listeners = new Set<Listener<T>>();

  const getState = (): T => state;

  const setState = (partial: Partial<T> | ((prev: T) => Partial<T>)): void => {
    const resolved = typeof partial === "function" ? partial(state) : partial;
    const nextState = { ...state };
    let changed = false;

    for (const k of Object.keys(resolved)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const key = k as keyof T;
      const newVal = resolved[key];
      if (newVal !== undefined && !Object.is(state[key], newVal)) {
        nextState[key] = newVal;
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const prev = state;
    state = nextState;

    for (const listener of listeners) {
      listener(state, prev);
    }
  };

  const subscribe = (listener: Listener<T>): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState, setState, subscribe };
}
