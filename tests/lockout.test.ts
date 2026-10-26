import { describe, expect, it } from 'vitest';
import { LockoutGate } from '../src/services/lockout.js';

describe('LockoutGate', () => {
  it('backs off exponentially up to the cap and resets after success', () => {
    const gate = new LockoutGate({ baseMs: 1000, maxMs: 3000 });

    expect(gate.recordFailure(0)).toBe(1000);
    expect(gate.blockedForMs(250)).toBe(750);
    expect(gate.blockedForMs(1000)).toBe(0);
    expect(gate.recordFailure(0)).toBe(2000);
    expect(gate.recordFailure(0)).toBe(3000);
    expect(gate.recordFailure(0)).toBe(3000);
    expect(gate.failureCount).toBe(4);

    gate.reset();
    expect(gate.failureCount).toBe(0);
    expect(gate.blockedForMs(0)).toBe(0);
  });
});
