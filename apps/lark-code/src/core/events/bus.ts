import type { Event } from "../bus/events.js";

export type EventHandler = (event: Event) => Promise<void>;

export class EventBus {
  private _subscribers: EventHandler[] = [];

  subscribe(handler: EventHandler): void {
    this._subscribers.push(handler);
  }

  async publish(event: Event): Promise<void> {
    for (const handler of this._subscribers) {
      await handler(event);
    }
  }
}
