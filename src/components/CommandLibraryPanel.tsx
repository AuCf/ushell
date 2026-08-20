import React, { useMemo, useState } from 'react';
import { Clock3, Pause, Play, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Language } from '../i18n';
import {
  clearCommandHistory,
  addFavoriteCommand,
  CommandHistoryEntry,
  getCommandHistory,
  getFavoriteCommands,
  isCommandHistoryEnabled,
  removeFavoriteCommand,
  setCommandHistoryEnabled,
  toggleFavoriteCommand
} from '../services/commandHistory';

interface CommandLibraryPanelProps {
  serverId: string;
  theme: 'dark' | 'light';
  lang: Language;
  revision: number;
  onRun: (command: string) => void;
  onClose: () => void;
}

export const CommandLibraryPanel: React.FC<CommandLibraryPanelProps> = ({
  serverId,
  theme,
  lang,
  revision,
  onRun,
  onClose
}) => {
  const [tab, setTab] = useState<'history' | 'favorites'>('history');
  const [search, setSearch] = useState('');
  const [localRevision, setLocalRevision] = useState(0);
  const [newFavorite, setNewFavorite] = useState('');
  const [historyEnabled, setHistoryEnabled] = useState(isCommandHistoryEnabled);
  const isLight = theme === 'light';

  const { history, favorites } = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return {
      history: getCommandHistory().filter(item =>
        item.serverId === serverId && (!keyword || item.command.toLowerCase().includes(keyword))
      ),
      favorites: getFavoriteCommands().filter(item => !keyword || item.toLowerCase().includes(keyword))
    };
  }, [serverId, search, revision, localRevision]);

  const refresh = () => setLocalRevision(value => value + 1);
  const toggleFavorite = (command: string) => {
    toggleFavoriteCommand(command);
    refresh();
  };
  const run = (command: string) => onRun(`${command.replace(/[\r\n]+$/, '')}\r`);

  return (
    <aside className={`flex h-full w-72 shrink-0 flex-col border-l font-sans ${
      isLight ? 'border-slate-200 bg-white text-slate-800' : 'border-[#252832] bg-[#101116] text-zinc-200'
    }`}>
      <div className={`flex h-9 items-center justify-between border-b px-3 ${isLight ? 'border-slate-200' : 'border-[#252832]'}`}>
        <span className="text-xs font-semibold">{lang === 'zh' ? '命令库' : 'Commands'}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const enabled = !historyEnabled;
              setHistoryEnabled(enabled);
              setCommandHistoryEnabled(enabled);
            }}
            className={`rounded p-1 hover:bg-zinc-500/10 ${historyEnabled ? 'text-zinc-500' : 'text-amber-500'}`}
            title={historyEnabled
              ? (lang === 'zh' ? '暂停记录命令历史' : 'Pause command history')
              : (lang === 'zh' ? '恢复记录命令历史' : 'Resume command history')}
          >
            {historyEnabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-500/10"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className={`flex border-b px-2 pt-2 ${isLight ? 'border-slate-200' : 'border-[#252832]'}`}>
        {(['history', 'favorites'] as const).map(value => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 border-b-2 px-2 pb-2 text-[11px] ${tab === value
              ? 'border-emerald-500 text-emerald-500'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            {value === 'history' ? (lang === 'zh' ? '历史记录' : 'History') : (lang === 'zh' ? '常用命令' : 'Favorites')}
          </button>
        ))}
      </div>
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3 w-3 text-zinc-500" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={lang === 'zh' ? '搜索命令' : 'Search commands'}
            className={`w-full rounded border py-1.5 pl-7 pr-2 font-mono text-[11px] outline-none ${
              isLight ? 'border-slate-200 bg-slate-50 focus:border-slate-400' : 'border-[#292c36] bg-[#0b0c10] focus:border-zinc-500'
            }`}
          />
        </div>
        {tab === 'favorites' && (
          <div className="mt-2 flex gap-1">
            <input
              value={newFavorite}
              onChange={event => setNewFavorite(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || !newFavorite.trim()) return;
                addFavoriteCommand(newFavorite);
                setNewFavorite('');
                refresh();
              }}
              placeholder={lang === 'zh' ? '输入常用命令' : 'Add a command'}
              className={`min-w-0 flex-1 rounded border px-2 py-1.5 font-mono text-[11px] outline-none ${isLight ? 'border-slate-200 bg-slate-50' : 'border-[#292c36] bg-[#0b0c10]'}`}
            />
            <button
              onClick={() => {
                if (!newFavorite.trim()) return;
                addFavoriteCommand(newFavorite);
                setNewFavorite('');
                refresh();
              }}
              className="rounded border border-emerald-500/30 px-2 text-emerald-500 hover:bg-emerald-500/10"
              title={lang === 'zh' ? '添加常用命令' : 'Add favorite command'}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {tab === 'history' ? (
          history.length ? history.map((entry: CommandHistoryEntry) => (
            <div key={entry.id} className={`group mb-1 rounded border px-2 py-2 ${isLight ? 'border-slate-200 hover:bg-slate-50' : 'border-[#242731] hover:bg-[#171920]'}`}>
              <button onClick={() => run(entry.command)} className="block w-full break-all text-left font-mono text-[11px] leading-4">{entry.command}</button>
              <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-500">
                <span className="flex items-center gap-1"><Clock3 className="h-2.5 w-2.5" />{new Date(entry.executedAt).toLocaleString()}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={() => toggleFavorite(entry.command)} title={lang === 'zh' ? '收藏' : 'Favorite'}><Star className={`h-3 w-3 ${favorites.includes(entry.command) ? 'fill-amber-400 text-amber-400' : ''}`} /></button>
                  <button onClick={() => run(entry.command)} title={lang === 'zh' ? '执行' : 'Run'}><Play className="h-3 w-3" /></button>
                </div>
              </div>
            </div>
          )) : <Empty lang={lang} />
        ) : (
          favorites.length ? favorites.map(command => (
            <div key={command} className={`group mb-1 flex items-center gap-2 rounded border px-2 py-2 ${isLight ? 'border-slate-200' : 'border-[#242731]'}`}>
              <button onClick={() => run(command)} className="min-w-0 flex-1 break-all text-left font-mono text-[11px] leading-4">{command}</button>
              <button onClick={() => { removeFavoriteCommand(command); refresh(); }} className="text-zinc-500 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
            </div>
          )) : <Empty lang={lang} />
        )}
      </div>
      {tab === 'history' && history.length > 0 && (
        <button onClick={() => { clearCommandHistory(serverId); refresh(); }} className={`m-2 mt-0 rounded border py-1.5 text-[10px] text-zinc-500 hover:text-red-500 ${isLight ? 'border-slate-200' : 'border-[#292c36]'}`}>
          {lang === 'zh' ? '清空历史记录' : 'Clear history'}
        </button>
      )}
    </aside>
  );
};

const Empty = ({ lang }: { lang: Language }) => (
  <div className="py-12 text-center text-[11px] text-zinc-500">{lang === 'zh' ? '暂无命令' : 'No commands yet'}</div>
);
