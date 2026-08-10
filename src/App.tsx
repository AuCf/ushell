import React, { useState, useEffect } from 'react';
import { ServerProfile, SessionTab } from './types';
import { INITIAL_SERVERS } from './services/mockData';
import { Language, i18n } from './i18n';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SFTPManager } from './components/SFTPManager';
import { ServerMonitor } from './components/ServerMonitor';
import { AICopilot } from './components/AICopilot';
import { ServerModal } from './components/ServerModal';
import { FinalShellImportModal } from './components/FinalShellImportModal';
import { Toast, ToastMessage } from './components/Toast';
import { Terminal } from 'lucide-react';

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
    localStorage.setItem('ushell_groups', JSON.stringify(persistedGroups));
  }, [persistedGroups]);

  const allAvailableGroups = Array.from(
    new Set([
      ...persistedGroups,
      ...servers.map(s => s.group).filter((g): g is string => !!g)
    ])
  );

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('ushell_theme', nextTheme);
  };

  const toggleLang = () => {
    const nextLang = lang === 'zh' ? 'en' : 'zh';
    setLang(nextLang);
    localStorage.setItem('ushell_lang', nextLang);
  };

  const showToast = (text: string, type: ToastMessage['type'] = 'info') => {
    setToastMessage({ id: `t_${Date.now()}`, type, text });
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
      connected: false,
      activeView: 'both',
      createdAt: Date.now()
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    showToast(`${lang === 'zh' ? '正在连接: ' : 'Connecting to '}${server.name}`, 'info');
  };

  const handleConnectionStateChange = (serverId: string, connected: boolean, error?: string) => {
    setTabs(prev => prev.map(tab => tab.serverId === serverId ? { ...tab, connected } : tab));
    const server = servers.find(item => item.id === serverId);
    if (connected) {
      showToast(`${lang === 'zh' ? 'SSH 认证成功: ' : 'SSH authenticated: '}${server?.name || serverId}`, 'success');
    } else if (error) {
      showToast(error, 'error');
    }
  };

  const handleCloseTab = (id: string) => {
    const nextTabs = tabs.filter(t => t.id !== id);
    setTabs(nextTabs);
    if (activeTabId === id && nextTabs.length > 0) {
      setActiveTabId(nextTabs[nextTabs.length - 1].id);
    }
  };

  const handleToggleViewMode = (tabId: string, mode: 'terminal' | 'sftp' | 'both') => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, activeView: mode } : t));
  };

  const handleOpenAddServer = () => {
    setEditingServer(null);
    setIsServerModalOpen(true);
  };

  const handleOpenEditServer = (server: ServerProfile) => {
    setEditingServer(server);
    setIsServerModalOpen(true);
  };

  const handleSaveServer = (profileData: Omit<ServerProfile, 'id' | 'createdAt'> & { id?: string }) => {
    if (profileData.group && !persistedGroups.includes(profileData.group)) {
      setPersistedGroups(prev => [...prev, profileData.group!]);
    }

    if (profileData.id) {
      setServers(prev => prev.map(s => s.id === profileData.id ? {
        ...s,
        ...profileData
      } as ServerProfile : s));

      setTabs(prev => prev.map(t => t.serverId === profileData.id ? {
        ...t,
        title: profileData.name,
        host: profileData.host
      } : t));

      showToast(lang === 'zh' ? `已更新配置: ${profileData.name}` : `Updated ${profileData.name}`, 'success');
    } else {
      const newServer: ServerProfile = {
        ...profileData,
        id: `srv_${Date.now()}`,
        createdAt: Date.now()
      } as ServerProfile;

      setServers(prev => [newServer, ...prev]);
      handleConnectServer(newServer);
      showToast(lang === 'zh' ? `已新建主机: ${newServer.name}` : `Created ${newServer.name}`, 'success');
    }
  };

  const handleImportSuccess = (imported: ServerProfile[]) => {
    const importedGroups = imported.map(s => s.group).filter((g): g is string => !!g);
    setPersistedGroups(prev => Array.from(new Set([...prev, ...importedGroups])));
    setServers(prev => [...imported, ...prev]);
    if (imported.length > 0) {
      handleConnectServer(imported[0]);
    }
    showToast(lang === 'zh' ? `成功导入 ${imported.length} 台服务器` : `Imported ${imported.length} servers`, 'success');
  };

  const handleDeleteServer = (id: string) => {
    const target = servers.find(s => s.id === id);
    setServers(prev => prev.filter(s => s.id !== id));
    setTabs(prev => prev.filter(t => t.serverId !== id));
    if (target) showToast(lang === 'zh' ? `已删除 ${target.name}` : `Deleted ${target.name}`, 'info');
  };

  const handleAskAIWithContext = (errContent?: string) => {
    setErrorCtxForAI(errContent);
    setIsAICopilotOpen(true);
  };

  const handleInsertCommandToTerminal = (command: string) => {
    if (activeTabId && activeTab?.activeView === 'sftp') {
      handleToggleViewMode(activeTabId, 'both');
    }
    setPendingTerminalCommand(command);
    showToast(lang === 'zh' ? '命令已填入终端输入框' : 'Command inserted into terminal', 'info');
  };

  const isLight = theme === 'light';

  return (
    <div className={`h-screen w-screen flex overflow-hidden font-mono select-none ${
      isLight ? 'bg-[#f8fafc] text-[#0f172a]' : 'bg-[#09090b] text-[#e4e4e7]'
    }`}>
      {/* Sidebar */}
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

        {activeTab && activeServer ? (
          <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
            <div className="flex-1 flex min-h-0 w-full overflow-hidden">
              {(activeTab.activeView === 'terminal' || activeTab.activeView === 'both') && (
                <div className={`${activeTab.activeView === 'both' ? 'w-3/5' : 'w-full'} h-full flex flex-col min-w-0`}>
                  <TerminalView
                    server={activeServer}
                    theme={theme}
                    lang={lang}
                    onAskAIWithContext={handleAskAIWithContext}
                    pendingCommand={pendingTerminalCommand}
                    onCommandHandled={() => setPendingTerminalCommand(null)}
                    onConnectionStateChange={(connected, error) => handleConnectionStateChange(activeServer.id, connected, error)}
                  />
                </div>
              )}

              {(activeTab.activeView === 'sftp' || activeTab.activeView === 'both') && (
                <div className={`${activeTab.activeView === 'both' ? 'w-2/5' : 'w-full'} h-full flex flex-col min-w-0`}>
                  <SFTPManager server={activeServer} theme={theme} lang={lang} />
                </div>
              )}
            </div>

            <ServerMonitor serverName={activeServer.name} theme={theme} lang={lang} />
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
                {t.import} FINALSHELL
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

      <FinalShellImportModal
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
