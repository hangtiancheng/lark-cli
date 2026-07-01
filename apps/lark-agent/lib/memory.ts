// Corresponds to the source project's utility/mem/mem.go.
// In-memory conversation memory per session id, MaxWindowSize=6, drop in pairs.
import { type ModelMessage } from "ai";
import { MEMORY_WINDOW_SIZE } from "@/lib/config";

const memoryMap = new Map<string, SimpleMemory>();

export function getSimpleMemory(id: string): SimpleMemory {
  let mem = memoryMap.get(id);
  if (!mem) {
    mem = new SimpleMemory(id);
    memoryMap.set(id, mem);
  }
  return mem;
}

export class SimpleMemory {
  readonly id: string;
  messages: ModelMessage[] = [];
  readonly maxWindowSize = MEMORY_WINDOW_SIZE;

  constructor(id: string) {
    this.id = id;
  }

  // Append a message; when over the window, drop an even number from the front
  // to keep user/assistant pairs aligned (mirrors the source project).
  setMessages(msg: ModelMessage): void {
    this.messages.push(msg);
    if (this.messages.length > this.maxWindowSize) {
      let excess = this.messages.length - this.maxWindowSize;
      if (excess % 2 !== 0) excess++;
      this.messages = this.messages.slice(excess);
    }
  }

  getMessages(): ModelMessage[] {
    return this.messages;
  }
}
