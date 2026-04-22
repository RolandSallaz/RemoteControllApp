export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly maxEvents: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, now = Date.now()): boolean {
    if (!this.isAllowed(key, now)) {
      return false;
    }

    this.record(key, now);
    return true;
  }

  isAllowed(key: string, now = Date.now()): boolean {
    return this.getActiveEvents(key, now).length < this.maxEvents;
  }

  record(key: string, now = Date.now()): void {
    const activeEvents = this.getActiveEvents(key, now);
    activeEvents.push(now);
    this.events.set(key, activeEvents);
  }

  reset(key: string): void {
    this.events.delete(key);
  }

  private getActiveEvents(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const activeEvents = (this.events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (activeEvents.length === 0) {
      this.events.delete(key);
      return [];
    }

    this.events.set(key, activeEvents);
    return activeEvents;
  }
}

export function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
