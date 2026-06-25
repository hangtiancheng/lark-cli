import type { Message } from "../conversation/conversation.js";
import { ConversationManager } from "../conversation/conversation.js";

export function buildManager(messages: Message[]): ConversationManager {
  const mgr = new ConversationManager();
  for (const msg of messages) {
    if (msg.toolUses && msg.toolUses.length > 0) {
      mgr.addAssistantFull(msg.content, msg.thinkingBlocks ?? [], msg.toolUses);
    } else if (msg.toolResults && msg.toolResults.length > 0) {
      mgr.addToolResultsMessage(msg.toolResults);
    } else if (msg.role === "user") {
      mgr.addUserMessage(msg.content);
    } else if (msg.role === "assistant") {
      mgr.addAssistantMessage(msg.content);
    }
  }
  return mgr;
}
