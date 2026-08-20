import { describe, expect, it } from 'vitest';
import { addCommandHistory, getCommandHistory, shouldRecordCommand } from './commandHistory';

describe('command history privacy', () => {
  it('does not store input entered at a password prompt', () => {
    expect(shouldRecordCommand('my-secret', 'sudo password: ')).toBe(false);
    expect(shouldRecordCommand('my-secret', '\u001b[31m[sudo] password for root:\u001b[0m ')).toBe(false);
    expect(shouldRecordCommand('my-secret', "Enter passphrase for key '/root/.ssh/id_rsa': ")).toBe(false);
    expect(shouldRecordCommand('my-secret', 'Password for user@example.com: ')).toBe(false);
    expect(shouldRecordCommand('ls -la', 'root@host:~# ')).toBe(true);
  });

  it('never interrupts terminal input when local storage is unavailable or malformed', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => '{"unexpected":true}',
        setItem: () => { throw new Error('storage disabled'); },
        removeItem: () => { throw new Error('storage disabled'); }
      } as unknown as Storage
    });

    try {
      expect(getCommandHistory()).toEqual([]);
      expect(() => addCommandHistory({ command: 'ls', serverId: 'srv_1', host: 'host' })).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
});
