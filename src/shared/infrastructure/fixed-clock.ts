import type { Clock } from "../domain/ports/clock";

/** In-memory fake of `SystemClock` for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(next: Date): void {
    this.current = new Date(next);
  }
}
