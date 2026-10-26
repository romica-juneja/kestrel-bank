/**
 * Simple in-memory brute-force protection: after `maxFailures` failed sign-ins for the same
 * username + IP within the window, further attempts are rejected until the window passes.
 * A real deployment would back this with a shared store (e.g. Redis).
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (now - entry.firstAt > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) this.failures.set(key, { count: 1, firstAt: now });
    else entry.count += 1;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
