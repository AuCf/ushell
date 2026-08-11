import React from 'react';
import { SessionTab } from '../types';
import { Language, i18n } from '../i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Plus, Minus, Square, X as CloseIcon, Sun, Moon, Languages } from 'lucide-react';

interface TabBarProps {
  tabs: SessionTab[];
  activeTabId?: string;
  theme?: 'dark' | 'light';
  lang?: Language;
  onToggleTheme?: () => void;
  onToggleLang?: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onToggleViewMode: (tabId: string, mode: 'terminal' | 'sftp' | 'both') => void;
  onNewSession: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  theme = 'dark',
  lang = 'zh',
  onToggleTheme,
  onToggleLang,
  onSelectTab,
  onCloseTab,
  onToggleViewMode,
  onNewSession
}) => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isLight = theme === 'light';
  const t = i18n[lang];

  // Tauri Window Control Handlers (Async)
  const handleWindowMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWin = getCurrentWindow();
      await appWin.minimize();
    } catch (err) {
      try {
        await (window as any).__TAURI__?.window?.getCurrentWindow()?.minimize();
      } catch (e) {}
    }
  };

  const handleWindowMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWin = getCurrentWindow();
      await appWin.toggleMaximize();
    } catch (err) {
      try {
        await (window as any).__TAURI__?.window?.getCurrentWindow()?.toggleMaximize();
      } catch (e) {}
    }
  };

  const handleWindowClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWin = getCurrentWindow();
      await appWin.close();
    } catch (err) {
      try {
        await (window as any).__TAURI__?.window?.getCurrentWindow()?.close();
      } catch (e) {
        window.close();
      }
    }
  };

  return (
    <div 
      className={`h-8 border-b flex items-center justify-between px-1 select-none font-mono text-[11px] z-10 cursor-default transition-colors ${
        isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-700' : 'bg-[#0c0c0e] border-[#1a1a1e] text-zinc-300'
      }`}
    >
      {/* Tab List & Draggable Top Bar Area */}
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1 h-full" data-tauri-drag-region>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors max-w-[180px] border-r ${
                isLight 
                  ? (isActive ? 'bg-white text-slate-900 border-t-2 border-t-slate-800 border-r-slate-200 font-semibold shadow-sm' : 'bg-[#f1f5f9] hover:bg-slate-200/60 border-r-slate-200 text-slate-500')
                  : (isActive ? 'bg-[#18181c] text-white border-t border-t-zinc-400 border-r-[#1a1a1e] font-semibold' : 'bg-[#0e0e11] hover:bg-[#141418] border-r-[#1a1a1e] text-zinc-500')
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${tab.connected ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
              <span className="truncate">{tab.title}</span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ml-auto ${
                  isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#27272a] text-zinc-500 hover:text-zinc-200'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        <button
          onClick={onNewSession}
          className={`p-1 rounded transition-colors ml-1 ${
            isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#18181c] text-zinc-500 hover:text-zinc-200'
          }`}
          title="New Tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        {/* Draggable Window Drag Space between tabs and right buttons */}
        <div className="flex-1 h-full min-w-[30px]" data-tauri-drag-region />
      </div>

      {/* View Switcher, Language Toggle, Theme Toggle & Non-Drag Window Controls */}
      <div className="flex items-center gap-2 z-30 shrink-0">
        {activeTab && (
          <div className={`flex items-center gap-0.5 p-0.5 rounded border text-[10px] font-mono ${
            isLight ? 'bg-white border-slate-200' : 'bg-[#09090b] border-[#1a1a1e]'
          }`}>
            <button
              onClick={() => onToggleViewMode(activeTab.id, 'terminal')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                activeTab.activeView === 'terminal' 
                  ? (isLight ? 'bg-slate-900 text-white font-bold' : 'bg-[#27272a] text-white font-bold') 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.term}
            </button>

            <button
              onClick={() => onToggleViewMode(activeTab.id, 'sftp')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                activeTab.activeView === 'sftp' 
                  ? (isLight ? 'bg-slate-900 text-white font-bold' : 'bg-[#27272a] text-white font-bold') 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.sftp}
            </button>

            <button
              onClick={() => onToggleViewMode(activeTab.id, 'both')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                activeTab.activeView === 'both' 
                  ? (isLight ? 'bg-slate-900 text-white font-bold' : 'bg-[#27272a] text-white font-bold') 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.split}
            </button>
          </div>
        )}

        {/* Language Switcher */}
        <button
          onClick={onToggleLang}
          className={`px-1.5 py-0.5 border rounded text-[10px] font-mono font-bold transition-colors flex items-center gap-1 ${
            isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#16161a] border-[#24242a] text-zinc-300 hover:text-white'
          }`}
          title="切换中英文 / Toggle Language"
        >
          <Languages className="w-3 h-3 text-zinc-400" />
          <span>{lang === 'zh' ? 'EN' : '中'}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={onToggleTheme}
          className={`p-1 rounded transition-colors ${
            isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-[#1f1f24] text-zinc-400 hover:text-zinc-200'
          }`}
          title={isLight ? 'Dark Mode' : 'Light Mode'}
        >
          {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        </button>

        {/* Window Controls (Explicitly separated from drag region) */}
        <div 
          className={`flex items-center gap-0.5 border-l pl-1 z-30 ${
            isLight ? 'border-slate-300' : 'border-[#1a1a1e]'
          }`}
        >
          <button
            type="button"
            onClick={handleWindowMinimize}
            className={`p-1.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-[#1f1f24] text-zinc-500 hover:text-zinc-200'
            }`}
            title="最小化"
          >
            <Minus className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={handleWindowMaximize}
            className={`p-1.5 transition-colors cursor-pointer ${
              isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-[#1f1f24] text-zinc-500 hover:text-zinc-200'
            }`}
            title="最大化 / 还原"
          >
            <Square className="w-2.5 h-2.5" />
          </button>

          <button
            type="button"
            onClick={handleWindowClose}
            className="p-1.5 hover:bg-red-500 text-zinc-500 hover:text-white transition-colors cursor-pointer"
            title="关闭窗口"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
