export interface CommandHistoryEntry {
  id: string;
  command: string;
  serverId: string;
  host: string;
  executedAt: number;
}

const HISTORY_KEY = 'ushell_command_history:v1';
const LEGACY_HISTORY_KEY = 'ushell_command_history';
const FAVORITES_KEY = 'ushell_favorite_commands:v1';
const LEGACY_FAVORITES_KEY = 'ushell_favorite_commands';
const HISTORY_ENABLED_KEY = 'ushell_command_history_enabled:v1';
const MAX_HISTORY = 300;

const readJson = (key: string, legacyKey: string): unknown => {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeJson = (key: string, value: unknown, legacyKey?: string): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (legacyKey) localStorage.removeItem(legacyKey);
    return true;
  } catch {
    return false;
  }
};

const removeStoredValue = (key: string): void => {
  try { localStorage.removeItem(key); } catch { /* History is best-effort only. */ }
};

const isHistoryEntry = (value: unknown): value is CommandHistoryEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CommandHistoryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.command === 'string'
    && typeof entry.serverId === 'string'
    && typeof entry.host === 'string'
    && typeof entry.executedAt === 'number';
};

const stripTerminalControlSequences = (value: string): string => value
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

export const shouldRecordCommand = (command: string, recentOutput: string): boolean => {
  const value = command.trim();
  if (!value || value.length > 2000) return false;
  const promptTail = stripTerminalControlSequences(recentOutput).slice(-400);
  if (/(?:password|passphrase|authentication token|secret|验证码|密码)(?:\s+for\b[^\r\n:]*)?\s*[:：]\s*$/i.test(promptTail)) return false;
  if (/(?:^|\s)(?:--?)?(?:password|token|secret|api[_-]?key)(?:\s+|=)/i.test(value)) return false;
  if (/authorization\s*:/i.test(value)) return false;
  return true;
};

export const getCommandHistory = (): CommandHistoryEntry[] => {
  const value = readJson(HISTORY_KEY, LEGACY_HISTORY_KEY);
  return Array.isArray(value) ? value.filter(isHistoryEntry).slice(0, MAX_HISTORY) : [];
};

export const isCommandHistoryEnabled = (): boolean => {
  try { return localStorage.getItem(HISTORY_ENABLED_KEY) !== 'false'; } catch { return true; }
};

export const setCommandHistoryEnabled = (enabled: boolean): void => {
  try { localStorage.setItem(HISTORY_ENABLED_KEY, String(enabled)); } catch { /* Best-effort setting. */ }
};

export const addCommandHistory = (entry: Omit<CommandHistoryEntry, 'id' | 'executedAt'>): void => {
  if (!isCommandHistoryEnabled()) return;
  if (!shouldRecordCommand(entry.command, '')) return;
  const command = entry.command.trim();
  const current = getCommandHistory();
  const next: CommandHistoryEntry[] = [{
    ...entry,
    command,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    executedAt: Date.now()
  }, ...current.filter(item => !(item.serverId === entry.serverId && item.command === command))].slice(0, MAX_HISTORY);
  writeJson(HISTORY_KEY, next, LEGACY_HISTORY_KEY);
};

export const clearCommandHistory = (serverId?: string): void => {
  if (!serverId) {
    removeStoredValue(HISTORY_KEY);
    removeStoredValue(LEGACY_HISTORY_KEY);
    return;
  }
  writeJson(HISTORY_KEY, getCommandHistory().filter(item => item.serverId !== serverId), LEGACY_HISTORY_KEY);
};

export const getFavoriteCommands = (): string[] => {
  const value = readJson(FAVORITES_KEY, LEGACY_FAVORITES_KEY);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

export const addFavoriteCommand = (command: string): void => {
  const value = command.trim();
  if (!shouldRecordCommand(value, '')) return;
  writeJson(FAVORITES_KEY, [value, ...getFavoriteCommands().filter(item => item !== value)], LEGACY_FAVORITES_KEY);
};

export const toggleFavoriteCommand = (command: string): boolean => {
  const value = command.trim();
  const current = getFavoriteCommands();
  const exists = current.includes(value);
  const next = exists ? current.filter(item => item !== value) : [value, ...current];
  if (!exists && !shouldRecordCommand(value, '')) return false;
  writeJson(FAVORITES_KEY, next, LEGACY_FAVORITES_KEY);
  return !exists;
};

export const removeFavoriteCommand = (command: string): void => {
  writeJson(FAVORITES_KEY, getFavoriteCommands().filter(item => item !== command), LEGACY_FAVORITES_KEY);
};
