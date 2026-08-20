import { describe, expect, it } from 'vitest';
import { reconnectDelay } from './terminalReconnect';

describe('reconnectDelay', () => {
  it('uses bounded linear delays', () => {
    expect([1, 2, 3, 4].map(reconnectDelay)).toEqual([3000, 6000, 9000, 9000]);
  });
});
