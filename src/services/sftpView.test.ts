import { describe, expect, it } from 'vitest';
import { SFTPItem } from '../types';
import { filterSftpItems } from './sftpView';

const item = (name: string): SFTPItem => ({
  name,
  path: `/${name}`,
  isDirectory: false,
  size: 0,
  modifiedTime: '-',
  permissions: '-rw-r--r--'
});
describe('filterSftpItems', () => {
  it('hides dotfiles by default', () => {
    expect(filterSftpItems([item('.env'), item('app.log')], false).map(value => value.name)).toEqual(['app.log']);
  });

  it('returns hidden files when enabled', () => {
    expect(filterSftpItems([item('.env')], true)).toHaveLength(1);
  });
});
