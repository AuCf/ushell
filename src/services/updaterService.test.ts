import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './updaterService';

describe('isNewerVersion', () => {
  it('compares semantic version segments', () => {
    expect(isNewerVersion('0.0.6', '0.0.7')).toBe(true);
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(false);
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false);
  });
});
