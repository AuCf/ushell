import React, { useState } from 'react';
import { ServerProfile } from '../types';
import { Language, i18n } from '../i18n';
import { 
  Plus, 
  Download, 
  Search, 
  Trash2, 
  Edit2, 
  ChevronRight, 
  ChevronDown,
  Key
} from 'lucide-react';

interface SidebarProps {
  servers: ServerProfile[];
  activeServerId?: string;
  theme?: 'dark' | 'light';
  lang?: Language;
  hasUpdate?: boolean;
  onConnectServer: (server: ServerProfile) => void;
  onAddServer: () => void;
  onEditServer: (server: ServerProfile) => void;
  onImportFinalShell: () => void;
  onDeleteServer: (id: string) => void;
  onOpenAICopilot: () => void;
  onOpenUpdateModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  servers,
  activeServerId,
  theme = 'dark',
  lang = 'zh',
  hasUpdate = false,
  onConnectServer,
  onAddServer,
  onEditServer,
  onImportFinalShell,
  onDeleteServer,
  onOpenAICopilot,
  onOpenUpdateModal
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isLight = theme === 'light';
  const t = i18n[lang];

  const groupedServers = servers.reduce((acc, server) => {
    const groupName = server.group || t.defaultGroup;
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(server);
    return acc;
  }, {} as Record<string, ServerProfile[]>);

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const filteredServers = servers.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <aside className={`w-60 border-r flex flex-col h-full select-none font-mono text-xs z-20 transition-colors ${
      isLight ? 'bg-[#f8fafc] border-[#e2e8f0] text-slate-700' : 'bg-[#0c0c0e] border-[#1a1a1e] text-zinc-300'
    }`}>
      {/* Title with Stylized U Logo */}
      <div className={`h-9 px-2.5 border-b flex items-center justify-between font-mono gap-1 shrink-0 ${
        isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-800' : 'bg-[#0e0e11] border-[#1a1a1e] text-zinc-400'
      }`}>
        <div className="flex items-center gap-1.5 font-bold tracking-tight min-w-0 flex-1 overflow-hidden">
          <div className="w-5 h-5 rounded overflow-hidden border border-emerald-500/40 bg-zinc-900 flex items-center justify-center shrink-0">
            <img src="/ushell_logo.jpg" alt="uShell Logo" className="w-full h-full object-cover" />
          </div>
          <span className={`font-extrabold tracking-wider truncate text-[12px] shrink-0 ${isLight ? 'text-slate-900' : 'text-zinc-100'}`}>uShell</span>
          
          {/* Version badge with pulsing amber update dot */}
          <button
            onClick={onOpenUpdateModal}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer group"
            title={hasUpdate ? (lang === 'zh' ? '检测到新版本可用！点击进行热更新升级' : 'New version available! Click to update') : `uShell v0.0.3`}
          >
            <span className={`text-[9px] font-normal shrink-0 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>v0.0.3</span>
            {hasUpdate && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
              </span>
            )}
          </button>
        </div>

        <button
          onClick={onOpenAICopilot}
          className={`px-1.5 py-0.5 border text-[10px] font-mono rounded shrink-0 whitespace-nowrap ${
            isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#16161a] border-[#24242a] text-zinc-400 hover:text-zinc-200'
          }`}
          title="AI Command Palette"
        >
          {t.aiCmd}
        </button>
      </div>

      {/* Actions */}
      <div className={`p-2 space-y-1.5 border-b ${isLight ? 'border-[#e2e8f0]' : 'border-[#1a1a1e]'}`}>
        <div className="flex gap-1">
          <button
            onClick={onAddServer}
            className={`flex-1 py-1 px-2 border font-mono text-[11px] rounded flex items-center justify-center gap-1 transition-colors ${
              isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-200 hover:text-white'
            }`}
          >
            <Plus className="w-3 h-3 text-zinc-400" />
            {t.newHost}
          </button>

          <button
            onClick={onImportFinalShell}
            className={`py-1 px-2 border font-mono text-[11px] rounded flex items-center justify-center gap-1 transition-colors ${
              isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Download className="w-3 h-3 text-zinc-400" />
            {t.import}
          </button>
        </div>

        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2 text-zinc-400" />
          <input
            type="text"
            placeholder={t.filter}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-6 pr-2 py-1 border rounded text-[11px] font-mono focus:outline-none ${
              isLight ? 'bg-white border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#121215] border-[#1e1e24] text-zinc-200 focus:border-zinc-500'
            }`}
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1 space-y-1 text-[11px]">
        {searchTerm ? (
          <div className="space-y-0.5">
            <div className="px-2 py-1 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
              {t.filter} ({filteredServers.length})
            </div>
            {filteredServers.map(server => (
              <ServerItem 
                key={server.id} 
                server={server} 
                isActive={server.id === activeServerId}
                isLight={isLight}
                onConnect={() => onConnectServer(server)}
                onEdit={() => onEditServer(server)}
                onDelete={() => onDeleteServer(server.id)}
              />
            ))}
          </div>
        ) : (
          Object.entries(groupedServers).map(([groupName, groupServers]) => {
            const isCollapsed = collapsedGroups[groupName];
            return (
              <div key={groupName} className="space-y-0.5">
                <button
                  onClick={() => toggleGroup(groupName)}
                  className={`w-full flex items-center justify-between px-1.5 py-1 font-bold text-[10px] tracking-wider uppercase rounded transition-colors ${
                    isLight ? 'text-slate-500 hover:bg-slate-100' : 'text-zinc-500 hover:bg-[#141418]'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    <span>{groupName}</span>
                  </div>
                  <span className="text-[9px] text-zinc-500 font-mono">[{groupServers.length}]</span>
                </button>

                {!isCollapsed && (
                  <div className="space-y-0.5 pl-1.5">
                    {groupServers.map(server => (
                      <ServerItem 
                        key={server.id} 
                        server={server} 
                        isActive={server.id === activeServerId}
                        isLight={isLight}
                        onConnect={() => onConnectServer(server)}
                        onEdit={() => onEditServer(server)}
                        onDelete={() => onDeleteServer(server.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className={`h-7 px-2.5 border-t text-[10px] flex items-center justify-between font-mono ${
        isLight ? 'border-slate-200 bg-[#f1f5f9] text-slate-500' : 'border-[#1a1a1e] bg-[#0c0c0e] text-zinc-600'
      }`}>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {t.online}
        </span>
        <span>SSH:22</span>
      </div>
    </aside>
  );
};

interface ServerItemProps {
  server: ServerProfile;
  isActive: boolean;
  isLight?: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ServerItem: React.FC<ServerItemProps> = ({ server, isActive, isLight, onConnect, onEdit, onDelete }) => {
  return (
    <div
      onClick={onConnect}
      className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors border font-mono ${
        isLight
          ? (isActive ? 'bg-slate-200/80 border-slate-300 text-slate-900 font-medium' : 'bg-transparent border-transparent hover:bg-slate-100 text-slate-700')
          : (isActive ? 'bg-[#1c1c22] border-[#2e2e38] text-white font-medium' : 'bg-transparent border-transparent hover:bg-[#141418] text-zinc-400 hover:text-zinc-200')
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] flex items-center gap-1">
          <span className="truncate">{server.name}</span>
          {server.authType === 'privateKey' && (
            <span title="Key Auth"><Key className="w-2.5 h-2.5 text-zinc-400 shrink-0" /></span>
          )}
        </div>
        <div className={`text-[9px] truncate ${isLight ? 'text-slate-500' : 'text-zinc-600'}`}>
          {server.username}@{server.host}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={`px-1 py-0.5 rounded ${isLight ? 'hover:bg-slate-300 text-slate-600' : 'hover:bg-[#27272a] text-zinc-400'}`}
          title="Edit"
        >
          <Edit2 className="w-3 h-3 text-zinc-400" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={`px-1 py-0.5 rounded ${isLight ? 'hover:bg-slate-300 text-slate-600 hover:text-red-600' : 'hover:bg-[#27272a] text-zinc-500 hover:text-red-400'}`}
          title="Delete"
        >
          <Trash2 className="w-3 h-3 text-zinc-400" />
        </button>
      </div>
    </div>
  );
};
