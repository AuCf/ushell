import React, { useState, useEffect } from 'react';
import { ServerProfile, SessionTab } from './types';
import { Language, i18n } from './i18n';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SFTPManager } from './components/SFTPManager';
import { ServerMonitor } from './components/ServerMonitor';
import { AICopilot } from './components/AICopilot';
import { ServerModal } from './components/ServerModal';
import { ImportConfigModal } from './components/ImportConfigModal';
import { Toast, ToastMessage } from './components/Toast';

export function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('ushell_theme') as 'dark' | 'light') || 'dark';
  });

  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('ushell_lang') as Language) || 'zh';
  });

  const [servers, setServers] = useState<ServerProfile[]>(() => {
    const stored = localStorage.getItem('ushell_servers');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    return [];
  });

  const [persistedGroups, setPersistedGroups] = useState<string[]>(() => {
    const stored = localStorage.getItem('ushell_groups');
    if (stored) {
      try { return JSON.parse(stored); } catch (e) {}
    }
    return ['DEFAULT', 'PROD', 'STAGING', 'DEV', '默认分组', '生产环境', '测试环境'];
  });

  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [isAICopilotOpen, setIsAICopilotOpen] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerProfile | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [errorCtxForAI, setErrorCtxForAI] = useState<string | undefined>(undefined);
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeServer = servers.find(s => s.id === activeTab?.serverId);
  const t = i18n[lang];

  useEffect(() => {
    localStorage.setItem('ushell_servers', JSON.stringify(servers));
  }, [servers]);

  useEffect(() => {
    localStorage.setItem('ushell_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ushell_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('ushell_groups', JSON.stringify(persistedGroups));
  }, [persistedGroups]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const toggleLang = () => {
    setLang(prev => (prev === 'zh' ? 'en' : 'zh'));
  };

  const showToast = (title: string, message: string, type: ToastMessage['type'] = 'info') => {
    setToastMessage({ id: Date.now().toString(), text: `${title}: ${message}`, type });
  };

  const handleConnectServer = (server: ServerProfile) => {
    const existingTab = tabs.find(t => t.serverId === server.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: SessionTab = {
      id: `tab_${Date.now()}`,
      serverId: server.id,
      title: server.name,
      host: server.host,
      connected: true,
      activeView: 'terminal',
      createdAt: Date.now()
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    showToast(
      lang === 'zh' ? '会话建立' : 'Session Connected',
      `${lang === 'zh' ? '已连接至' : 'Connected to'} ${server.username}@${server.host}:${server.port}`,
      'success'
    );
  };

  const handleCloseTab = (tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId('');
      }
      return filtered;
    });
  };

  const handleToggleViewMode = (tabId: string, mode: 'terminal' | 'sftp' | 'both') => {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, activeView: mode } : t)));
  };

  const handleOpenAddServer = () => {
    setEditingServer(null);
    setIsServerModalOpen(true);
  };

  const handleOpenEditServer = (server: ServerProfile) => {
    setEditingServer(server);
    setIsServerModalOpen(true);
  };

  const handleSaveServer = (serverData: Omit<ServerProfile, 'id' | 'createdAt'> & { id?: string }) => {
    if (serverData.group && !persistedGroups.includes(serverData.group)) {
      setPersistedGroups(prev => [...prev, serverData.group!]);
    }

    if (serverData.id) {
      setServers(prev => prev.map(s => (s.id === serverData.id ? { ...s, ...serverData } as ServerProfile : s)));
      setTabs(prev => prev.map(t => (t.serverId === serverData.id ? { ...t, title: serverData.name } : t)));
      showToast(lang === 'zh' ? '更新成功' : 'Updated', `${serverData.name} ${lang === 'zh' ? '参数已修改' : 'configuration updated'}`, 'success');
    } else {
      const newServer: ServerProfile = {
        ...serverData,
        id: `srv_${Date.now()}`,
        createdAt: Date.now()
      };
      setServers(prev => [...prev, newServer]);
      showToast(lang === 'zh' ? '保存成功' : 'Saved', `${newServer.name} ${lang === 'zh' ? '节点已添加' : 'host added'}`, 'success');
      handleConnectServer(newServer);
    }
  };

  const handleDeleteServer = (id: string) => {
    const target = servers.find(s => s.id === id);
    if (!target) return;
    setServers(prev => prev.filter(s => s.id !== id));
    setTabs(prev => {
      const remaining = prev.filter(t => t.serverId !== id);
      if (activeTab && activeTab.serverId === id) {
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : '');
      }
      return remaining;
    });
    showToast(lang === 'zh' ? '已被移除' : 'Removed', `${target.name} ${lang === 'zh' ? '节点已从列表删除' : 'deleted'}`, 'warning');
  };

  const handleImportSuccess = (imported: ServerProfile[]) => {
    if (imported.length === 0) return;
    const newGroups = imported.map(s => s.group).filter(Boolean) as string[];
    setPersistedGroups(prev => Array.from(newSet([...prev, ...newGroups])));

    setServers(prev => {
      const existingHosts = new Set(prev.map(s => `${s.host}:${s.port}`));
      const nonDuplicates = imported.filter(s => !existingHosts.has(`${s.host}:${s.port}`));
      return [...prev, ...nonDuplicates];
    });

    showToast(
      lang === 'zh' ? '导入成功' : 'Import Complete',
      `${lang === 'zh' ? '新增' : 'Added'} ${imported.length} ${lang === 'zh' ? '台主机节点' : 'hosts'}`,
      'success'
    );
  };

  const newSet = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

  const handleAskAIWithContext = (errorContext?: string) => {
    setErrorCtxForAI(errorContext);
    setIsAICopilotOpen(true);
  };

  const handleInsertCommandToTerminal = (command: string) => {
    if (!activeTabId) {
      showToast(lang === 'zh' ? '无法写入' : 'No Active Session', lang === 'zh' ? '请先打开一个终端会话标签页' : 'Open a terminal tab first', 'error');
      return;
    }
    setPendingTerminalCommand(command);
    setIsAICopilotOpen(false);
    showToast(lang === 'zh' ? '已注入' : 'Command Injected', command, 'info');
  };

  const handleConnectionStateChange = (serverId: string, connected: boolean, error?: string) => {
    setTabs(prev => prev.map(t => (t.serverId === serverId ? { ...t, connected } : t)));
    if (error) {
      showToast(lang === 'zh' ? '连接失败' : 'Connection Error', error, 'error');
    }
  };

  const allAvailableGroups = Array.from(new Set([
    ...persistedGroups,
    ...servers.map(s => s.group).filter(Boolean) as string[]
  ]));

  const isLight = theme === 'light';

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans select-none ${
      isLight ? 'bg-[#f8fafc] text-slate-800' : 'bg-[#09090b] text-zinc-100'
    }`}>
      {/* Sidebar navigation */}
      <Sidebar
        servers={servers}
        activeServerId={activeServer?.id}
        theme={theme}
        lang={lang}
        onConnectServer={handleConnectServer}
        onAddServer={handleOpenAddServer}
        onEditServer={handleOpenEditServer}
        onImportFinalShell={() => setIsImportModalOpen(true)}
        onDeleteServer={handleDeleteServer}
        onOpenAICopilot={() => setIsAICopilotOpen(true)}
      />

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          theme={theme}
          lang={lang}
          onToggleTheme={toggleTheme}
          onToggleLang={toggleLang}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onToggleViewMode={handleToggleViewMode}
          onNewSession={handleOpenAddServer}
        />

        {tabs.length > 0 ? (
          <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
            {tabs.map((tab) => {
              const tabServer = servers.find(s => s.id === tab.serverId);
              if (!tabServer) return null;
              const isActive = tab.id === activeTabId;
              const terminalVisible = isActive && (tab.activeView === 'terminal' || tab.activeView === 'both');

              return (
                <div
                  key={tab.id}
                  className={`flex-1 flex-col min-h-0 w-full overflow-hidden ${
                    isActive ? 'flex' : 'hidden'
                  }`}
                >
                  <div className="flex-1 flex min-h-0 w-full overflow-hidden">
                    <div className={`${isActive && tab.activeView === 'both' ? 'w-3/5' : 'w-full'} h-full flex flex-col min-w-0 ${terminalVisible ? '' : 'hidden'}`}>
                      <TerminalView
                        server={tabServer}
                        theme={theme}
                        lang={lang}
                        visible={terminalVisible}
                        onAskAIWithContext={handleAskAIWithContext}
                        pendingCommand={isActive ? pendingTerminalCommand : null}
                        onCommandHandled={() => setPendingTerminalCommand(null)}
                        onConnectionStateChange={(connected, error) => handleConnectionStateChange(tabServer.id, connected, error)}
                      />
                    </div>

                    {isActive && (tab.activeView === 'sftp' || tab.activeView === 'both') && (
                      <div className={`${tab.activeView === 'both' ? 'w-2/5' : 'w-full'} h-full flex flex-col min-w-0`}>
                        <SFTPManager server={tabServer} theme={theme} lang={lang} />
                      </div>
                    )}
                  </div>

                  <ServerMonitor serverName={tabServer.name} theme={theme} lang={lang} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center font-mono ${
            isLight ? 'bg-[#f8fafc] text-slate-500' : 'bg-[#09090b] text-zinc-500'
          }`}>
            <div className={`w-12 h-12 rounded-xl border shadow-xl flex items-center justify-center mb-3 overflow-hidden ${
              isLight ? 'bg-white border-slate-200' : 'bg-[#121215] border-[#1e1e24]'
            }`}>
              <img src="/ushell_logo.jpg" alt="uShell Logo" className="w-full h-full object-cover" />
            </div>
            <h2 className={`text-sm font-extrabold tracking-wider mb-1 ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>{t.appTitle}</h2>
            <p className="text-[11px] max-w-sm mb-4 text-zinc-500">
              {lang === 'zh' ? '极简、纯粹的跨平台 SSH / SFTP 极客客户端' : 'Minimalist SSH & SFTP Client with xterm.js PTY engine.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleOpenAddServer}
                className={`py-1 px-3 border font-bold text-xs rounded transition-colors ${
                  isLight ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800' : 'bg-[#18181c] hover:bg-[#222228] border-[#27272a] text-zinc-200'
                }`}
              >
                {t.newHost}
              </button>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className={`py-1 px-3 border text-xs rounded transition-colors ${
                  isLight ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50' : 'bg-[#18181c] hover:bg-[#222228] border-[#27272a] text-zinc-400'
                }`}
              >
                {t.import}
              </button>
            </div>
          </div>
        )}

        <AICopilot
          isOpen={isAICopilotOpen}
          theme={theme}
          lang={lang}
          onClose={() => setIsAICopilotOpen(false)}
          onInsertCommandToTerminal={handleInsertCommandToTerminal}
          initialErrorContext={errorCtxForAI}
        />
      </main>

      <ServerModal
        isOpen={isServerModalOpen}
        editingServer={editingServer}
        existingGroups={allAvailableGroups}
        theme={theme}
        lang={lang}
        onClose={() => setIsServerModalOpen(false)}
        onSave={handleSaveServer}
      />

      <ImportConfigModal
        isOpen={isImportModalOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={handleImportSuccess}
      />

      <Toast toast={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
