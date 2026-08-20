import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { UpdateModal } from './components/UpdateModal';
import { SshHostKeyModal } from './components/SshHostKeyModal';
import { TrustedHostsModal } from './components/TrustedHostsModal';
import { Toast, ToastMessage } from './components/Toast';
import { checkGitHubUpdate, ReleaseInfo } from './services/updaterService';
import {
  deleteServerCredential,
  hydrateServerProfiles,
  saveServerCredential,
  stripServerSecrets
} from './services/credentialService';
import { clearCommandHistory } from './services/commandHistory';
import { invokeWithHostTrust, UnknownHostKey } from './services/sshTrustService';

interface HostKeyPrompt {
  hostKey: UnknownHostKey;
  resolve: (confirmed: boolean) => void;
}

export function App() {
  const connectingServerIdsRef = useRef(new Set<string>());
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
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [canStripStoredSecrets, setCanStripStoredSecrets] = useState(false);

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
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPrompt | null>(null);
  const [isTrustedHostsOpen, setIsTrustedHostsOpen] = useState(false);

  const confirmHostKey = useCallback((hostKey: UnknownHostKey) => new Promise<boolean>((resolve) => {
    setHostKeyPrompt({ hostKey, resolve });
  }), []);

  const settleHostKeyPrompt = useCallback((confirmed: boolean) => {
    if (!hostKeyPrompt) return;
    hostKeyPrompt.resolve(confirmed);
    setHostKeyPrompt(null);
  }, [hostKeyPrompt]);

  // GitHub Auto Updater State
  const [hasUpdate, setHasUpdate] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeServer = servers.find(s => s.id === activeTab?.serverId);
  const t = i18n[lang];

  useEffect(() => {
    // Check GitHub for new release on startup
    checkGitHubUpdate().then(res => {
      if (res.hasUpdate && res.release) {
        setHasUpdate(true);
        setReleaseInfo(res.release);
        showToast(
          lang === 'zh' ? '发现新版本' : 'New Update Available',
          `v${res.release.version} ${lang === 'zh' ? '安装包已发布，点击左上角提示即可下载。' : 'is ready to download!'}`,
          'info'
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!credentialsReady) return;
    const persistedServers = canStripStoredSecrets ? servers.map(stripServerSecrets) : servers;
    localStorage.setItem('ushell_servers', JSON.stringify(persistedServers));
  }, [canStripStoredSecrets, credentialsReady, servers]);

  useEffect(() => {
    let cancelled = false;
    void hydrateServerProfiles(servers)
      .then(hydrated => {
        if (!cancelled) {
          setServers(hydrated);
          setCanStripStoredSecrets(true);
          setCredentialsReady(true);
        }
      })
      .catch(error => {
        if (!cancelled) {
          showToast(
            lang === 'zh' ? '凭据迁移失败' : 'Credential Migration Failed',
            typeof error === 'string' ? error : String(error),
            'error'
          );
          // Keep legacy credentials in local storage until every secret has
          // been durably written to and verified from the system keyring.
          setCanStripStoredSecrets(false);
          setCredentialsReady(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

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

  const handleConnectServer = async (server: ServerProfile) => {
    const existingTab = tabs.find(t => t.serverId === server.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    if (!credentialsReady) {
      showToast(
        lang === 'zh' ? '凭据加载中' : 'Loading Credentials',
        lang === 'zh' ? '系统凭据库正在初始化，请稍候重试' : 'The system credential store is still initializing',
        'info'
      );
      return;
    }

    if (connectingServerIdsRef.current.has(server.id)) return;
    connectingServerIdsRef.current.add(server.id);

    try {
      await invokeWithHostTrust('test_ssh_connection', {
        host: server.host,
        port: Number(server.port),
        username: server.username,
        password: server.authType === 'password' ? (server.password || null) : null,
        privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
        authType: server.authType
      }, lang, confirmHostKey);
    } catch (error) {
      showToast(
        lang === 'zh' ? '连接失败' : 'Connection Failed',
        typeof error === 'string' ? error : String(error),
        'error'
      );
      connectingServerIdsRef.current.delete(server.id);
      return;
    }

    const newTab: SessionTab = {
      id: `tab_${Date.now()}`,
      serverId: server.id,
      title: server.name,
      host: server.host,
      connected: true,
      activeView: 'terminal',
      sftpOpened: false,
      createdAt: Date.now()
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    connectingServerIdsRef.current.delete(server.id);
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
    setTabs(prev => prev.map(t => (t.id === tabId ? {
      ...t,
      activeView: mode,
      sftpOpened: t.sftpOpened || mode === 'sftp' || mode === 'both'
    } : t)));
  };

  const handleOpenAddServer = () => {
    setEditingServer(null);
    setIsServerModalOpen(true);
  };

  const handleOpenEditServer = (server: ServerProfile) => {
    setEditingServer(server);
    setIsServerModalOpen(true);
  };

  const handleSaveServer = async (serverData: Omit<ServerProfile, 'id' | 'createdAt'> & { id?: string }) => {
    if (serverData.group && !persistedGroups.includes(serverData.group)) {
      setPersistedGroups(prev => [...prev, serverData.group!]);
    }

    if (serverData.id) {
      const existing = servers.find(server => server.id === serverData.id);
      if (!existing) throw new Error(lang === 'zh' ? '服务器配置不存在' : 'Server profile no longer exists');
      const updated = { ...existing, ...serverData } as ServerProfile;
      await saveServerCredential(updated);
      setServers(prev => prev.map(s => (s.id === serverData.id ? updated : s)));
      setTabs(prev => prev.map(t => (t.serverId === serverData.id ? { ...t, title: serverData.name } : t)));
      showToast(lang === 'zh' ? '更新成功' : 'Updated', `${serverData.name} ${lang === 'zh' ? '参数已修改' : 'configuration updated'}`, 'success');
    } else {
      const newServer: ServerProfile = {
        ...serverData,
        id: `srv_${Date.now()}`,
        createdAt: Date.now()
      };
      await saveServerCredential(newServer);
      setServers(prev => [...prev, newServer]);
      showToast(lang === 'zh' ? '保存成功' : 'Saved', `${newServer.name} ${lang === 'zh' ? '节点已添加' : 'host added'}`, 'success');
      handleConnectServer(newServer);
    }
  };

  const handleDeleteServer = (id: string) => {
    const target = servers.find(s => s.id === id);
    if (!target) return;
    void deleteServerCredential(id).catch(error => {
      showToast(
        lang === 'zh' ? '凭据清理失败' : 'Credential Cleanup Failed',
        typeof error === 'string' ? error : String(error),
        'error'
      );
    });
    clearCommandHistory(id);
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

  const handleImportSuccess = async (imported: ServerProfile[]) => {
    if (imported.length === 0) return;
    const newGroups = imported.map(s => s.group).filter(Boolean) as string[];
    setPersistedGroups(prev => Array.from(newSet([...prev, ...newGroups])));

    const existingHosts = new Set(servers.map(s => `${s.host}:${s.port}`));
    const nonDuplicates = imported.filter(s => !existingHosts.has(`${s.host}:${s.port}`));
    await Promise.all(nonDuplicates.map(saveServerCredential));
    setServers(prev => [...prev, ...nonDuplicates]);

    showToast(
      lang === 'zh' ? '导入成功' : 'Import Complete',
      `${lang === 'zh' ? '新增' : 'Added'} ${nonDuplicates.length} ${lang === 'zh' ? '台主机节点' : 'hosts'}`,
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
        hasUpdate={hasUpdate}
        onConnectServer={handleConnectServer}
        onAddServer={handleOpenAddServer}
        onEditServer={handleOpenEditServer}
        onImportFinalShell={() => setIsImportModalOpen(true)}
        onDeleteServer={handleDeleteServer}
        onOpenAICopilot={() => setIsAICopilotOpen(true)}
        onOpenTrustedHosts={() => setIsTrustedHostsOpen(true)}
        onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
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
              const sftpVisible = isActive && (tab.activeView === 'sftp' || tab.activeView === 'both');

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

                    {tab.sftpOpened && (
                      <div className={`${sftpVisible && tab.activeView === 'both' ? 'w-2/5' : 'w-full'} h-full flex-col min-w-0 ${sftpVisible ? 'flex' : 'hidden'}`}>
                        <SFTPManager server={tabServer} theme={theme} lang={lang} />
                      </div>
                    )}
                  </div>

                  <ServerMonitor server={tabServer} active={isActive} theme={theme} lang={lang} />
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
        onConfirmHostKey={confirmHostKey}
      />

      <SshHostKeyModal
        hostKey={hostKeyPrompt?.hostKey || null}
        theme={theme}
        lang={lang}
        onCancel={() => settleHostKeyPrompt(false)}
        onConfirm={() => settleHostKeyPrompt(true)}
      />

      <TrustedHostsModal
        isOpen={isTrustedHostsOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsTrustedHostsOpen(false)}
      />

      <ImportConfigModal
        isOpen={isImportModalOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={handleImportSuccess}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        theme={theme}
        lang={lang}
        releaseInfo={releaseInfo}
        onClose={() => setIsUpdateModalOpen(false)}
      />

      <Toast toast={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
