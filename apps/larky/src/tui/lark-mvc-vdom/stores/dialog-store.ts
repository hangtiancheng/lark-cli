import { createStore } from "@lark.js/mvc";
import type { StoreApi } from "@lark.js/mvc";

interface DialogState {
  cursor: number;
  selectedIndex: number;
  isSubmitted: boolean;
}

interface DialogActions {
  moveCursor: (delta: number) => void;
  select: (index: number) => void;
  submit: () => void;
  reset: () => void;
}

type DialogStore = DialogState & DialogActions;

/** Create a dialog store with cursor navigation */
export function createDialogStore(optionCount: number): StoreApi<DialogStore> {
  return createStore("dialog", (set, get) => ({
    cursor: 0,
    selectedIndex: -1,
    isSubmitted: false,

    moveCursor(delta: number) {
      const current = get().cursor;
      const next = current + delta;
      if (next >= 0 && next < optionCount) {
        set({ cursor: next });
      }
    },

    select(index: number) {
      set({ selectedIndex: index, isSubmitted: true });
    },

    submit() {
      const cursor = get().cursor;
      set({ selectedIndex: cursor, isSubmitted: true });
    },

    reset() {
      set({ cursor: 0, selectedIndex: -1, isSubmitted: false });
    },
  }));
}

/** Cursor indicator */
export function renderCursor(isActive: boolean): string {
  return isActive ? "❯ " : "  ";
}
