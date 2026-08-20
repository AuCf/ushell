import { SFTPItem } from '../types';

export function filterSftpItems(items: SFTPItem[], showHiddenFiles: boolean): SFTPItem[] {
  return showHiddenFiles ? items : items.filter(item => !item.name.startsWith('.'));
}
