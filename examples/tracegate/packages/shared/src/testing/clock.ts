import { UtcDateTimeSchema, type UtcDateTime } from "../ids.ts";
import type { Clock } from "../ports.ts";

const abortError = () => new DOMException("The operation was aborted", "AbortError");

export class DeterministicClock implements Clock {
  #timestampMs: number;

  constructor(start: string | Date = "2026-09-01T12:00:00.000Z") {
    this.#timestampMs = new Date(start).getTime();
    if (!Number.isFinite(this.#timestampMs)) throw new TypeError("invalid deterministic clock start");
  }

  now(): Date {
    return new Date(this.#timestampMs);
  }

  nowIso(): UtcDateTime {
    return UtcDateTimeSchema.parse(this.now().toISOString());
  }

  advance(durationMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new RangeError("durationMs must be a non-negative safe integer");
    this.#timestampMs += durationMs;
  }

  async sleep(durationMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    this.advance(durationMs);
  }
}
