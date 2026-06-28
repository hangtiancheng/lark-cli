import { createStore } from "@lark.js/mvc";
import type { StoreApi } from "@lark.js/mvc";

interface InputState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  isMultiline: boolean;
  isFocused: boolean;
}

interface InputActions {
  setValue: (value: string) => void;
  insertChar: (char: string) => void;
  deleteChar: (direction: "back" | "forward") => void;
  moveCursor: (delta: number) => void;
  setCursor: (position: number) => void;
  addToHistory: (value: string) => void;
  navigateHistory: (direction: "up" | "down") => void;
  setFocused: (focused: boolean) => void;
  clear: () => void;
}

type InputStore = InputState & InputActions;

/** Create an input store */
export function createInputStore(): StoreApi<InputStore> {
  return createStore("input", (set, get) => ({
    value: "",
    cursor: 0,
    history: [],
    historyIndex: -1,
    isMultiline: false,
    isFocused: true,

    setValue(value: string) {
      set({
        value,
        cursor: value.length,
        isMultiline: value.includes("\n"),
      });
    },

    insertChar(char: string) {
      const { value, cursor } = get();
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const newValue = before + char + after;
      set({
        value: newValue,
        cursor: cursor + char.length,
        isMultiline: newValue.includes("\n"),
      });
    },

    deleteChar(direction: "back" | "forward") {
      const { value, cursor } = get();

      if (direction === "back" && cursor > 0) {
        const before = value.slice(0, cursor - 1);
        const after = value.slice(cursor);
        const newValue = before + after;
        set({
          value: newValue,
          cursor: cursor - 1,
          isMultiline: newValue.includes("\n"),
        });
      } else if (direction === "forward" && cursor < value.length) {
        const before = value.slice(0, cursor);
        const after = value.slice(cursor + 1);
        const newValue = before + after;
        set({
          value: newValue,
          cursor,
          isMultiline: newValue.includes("\n"),
        });
      }
    },

    moveCursor(delta: number) {
      const { value, cursor } = get();
      const next = cursor + delta;
      if (next >= 0 && next <= value.length) {
        set({ cursor: next });
      }
    },

    setCursor(position: number) {
      const { value } = get();
      if (position >= 0 && position <= value.length) {
        set({ cursor: position });
      }
    },

    addToHistory(value: string) {
      if (!value.trim()) {
        return;
      }
      const { history } = get();
      const newHistory = [value, ...history.slice(0, 49)];
      set({ history: newHistory });
    },

    navigateHistory(direction: "up" | "down") {
      const { history, historyIndex } = get();
      if (history.length === 0) {
        return;
      }

      let newIndex: number;
      if (direction === "up") {
        newIndex = historyIndex + 1;
      } else {
        newIndex = historyIndex - 1;
      }

      if (newIndex >= 0 && newIndex < history.length) {
        set({
          historyIndex: newIndex,
          value: history[newIndex],
          cursor: history[newIndex].length,
          isMultiline: history[newIndex].includes("\n"),
        });
      } else if (direction === "down" && historyIndex === 0) {
        set({
          historyIndex: -1,
          value: "",
          cursor: 0,
          isMultiline: false,
        });
      }
    },

    setFocused(focused: boolean) {
      set({ isFocused: focused });
    },

    clear() {
      set({
        value: "",
        cursor: 0,
        historyIndex: -1,
        isMultiline: false,
      });
    },
  }));
}
