export interface LockoutOptions {
  baseMs?: number;
  maxMs?: number;
}

/**
 * 连续失败后递增等待，但不永久锁定：本地单人应用若永久锁定，
 * 反而让攻击者可以通过拒绝服务破坏用户自己的数据。
 */
export class LockoutGate {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private failures = 0;
  private blockedUntil = 0;

  constructor(options: LockoutOptions = {}) {
    this.baseMs = options.baseMs ?? 1000;
    this.maxMs = options.maxMs ?? 30_000;
  }

  get failureCount(): number {
    return this.failures;
  }

  blockedForMs(now: number = Date.now()): number {
    return Math.max(0, this.blockedUntil - now);
  }

  recordFailure(now: number = Date.now()): number {
    this.failures += 1;
    const exponent = Math.min(this.failures - 1, 10);
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** exponent);
    this.blockedUntil = now + delay;
    return delay;
  }

  reset(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}
