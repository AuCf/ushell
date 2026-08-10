import React, { useEffect, useRef, useState } from 'react';
import { SFTPItem, ServerProfile } from '../types';
import { NewFolderModal } from './NewFolderModal';
import { Language, i18n } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCw } from 'lucide-react';

interface SFTPManagerProps {
  server: ServerProfile;
  theme?: 'dark' | 'light';
  lang?: Language;
}

interface SftpDirectoryResult {
  path: string;
  items: SFTPItem[];
}

export const SFTPManager: React.FC<SFTPManagerProps> = ({ server, theme = 'dark', lang = 'zh' }) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<SFTPItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const requestSequence = useRef(0);

  const isLight = theme === 'light';
  const t = i18n[lang];

  const connectionArgs = () => ({
    host: server.host,
    port: Number(server.port),
    username: server.username,
    password: server.authType === 'password' ? (server.password || null) : null,
    privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
    authType: server.authType
  });

  const loadDirectory = async (requestedPath: string) => {
    const requestId = ++requestSequence.current;
    setIsLoading(true);
    setError('');
    try {
      const result = await invoke<SftpDirectoryResult>('list_sftp_directory', {
        ...connectionArgs(),
        path: requestedPath
      });
      if (requestId !== requestSequence.current) return;

      setCurrentPath(result.path);
      setFiles(result.items.map(item => ({
        ...item,
        modifiedTime: /^\d+$/.test(item.modifiedTime)
          ? new Date(Number(item.modifiedTime) * 1000).toLocaleString()
          : (item.modifiedTime || '-')
      })));
      setSelectedItem(null);
    } catch (err: any) {
      if (requestId !== requestSequence.current) return;
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPath('.');
    setFiles([]);
    loadDirectory('.');
  }, [server.id, server.host, server.port, server.username, server.authType, server.password, server.privateKey]);

  const parentPath = currentPath === '/'
    ? null
    : (currentPath.slice(0, currentPath.lastIndexOf('/')) || '/');
  const visibleFiles: SFTPItem[] = parentPath
    ? [{
        name: '..',
        path: parentPath,
        isDirectory: true,
        size: 0,
        modifiedTime: '-',
        permissions: 'drwxr-xr-x'
      }, ...files]
    : files;

  const handleItemClick = (item: SFTPItem) => {
    setSelectedItem(item.name);
    if (item.isDirectory) {
      loadDirectory(item.path);
    }
  };

  const handleCreateFolderSubmit = async (folderName: string) => {
    setError('');
    try {
      await invoke('create_sftp_directory', {
        ...connectionArgs(),
        parentPath: currentPath,
        folderName
      });
      await loadDirectory(currentPath);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    }
  };

  return (
    <div className={`h-full border-l flex flex-col font-mono text-[11px] select-none ${
      isLight ? 'bg-white border-slate-200 text-slate-700' : 'bg-[#0a0a0c] border-[#1a1a1e] text-zinc-300'
    }`}>
      {/* Path Toolbar */}
      <div className={`p-1.5 border-b flex items-center justify-between gap-2 ${
        isLight ? 'bg-[#f1f5f9] border-slate-200' : 'bg-[#0e0e11] border-[#1a1a1e]'
      }`}>
        <div className={`flex items-center gap-1.5 min-w-0 flex-1 px-2 py-0.5 rounded border truncate ${
          isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-[#121215] border-[#1e1e24] text-zinc-300'
        }`}>
          <span className={`font-bold ${isLight ? 'text-slate-500' : 'text-zinc-600'}`}>DIR:</span>
          <span className="truncate">{currentPath}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsNewFolderModalOpen(true)}
            className={`px-1.5 py-0.5 border rounded transition-colors text-[10px] ${
              isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {t.mkdir}
          </button>

          <button
            disabled
            title={lang === 'zh' ? '真实文件上传尚未接入' : 'Real file upload is not available yet'}
            className={`px-1.5 py-0.5 border rounded text-[10px] cursor-not-allowed opacity-50 ${
              isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {t.upload}
          </button>

          <button
            onClick={() => loadDirectory(currentPath)}
            disabled={isLoading}
            className={`p-1 border rounded ${
              isLight ? 'bg-white border-slate-300 text-slate-500 hover:text-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-500 hover:text-zinc-300'
            }`}
            title={t.reload}
          >
            <RefreshCw className={`w-3 h-3 text-zinc-400 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className={`px-2.5 py-1.5 border-b text-[10px] break-words ${
          isLight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-950/30 border-red-900 text-red-400'
        }`}>
          {error}
        </div>
      )}

      {/* Ranger File Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`text-[10px] font-bold uppercase border-b ${
              isLight ? 'bg-[#f8fafc] text-slate-400 border-slate-200' : 'bg-[#0e0e11] text-zinc-600 border-[#1a1a1e]'
            }`}>
              <th className="py-1 px-2.5">{t.name}</th>
              <th className="py-1 px-1.5">{t.size}</th>
              <th className="py-1 px-1.5 hidden md:table-cell">{t.modified}</th>
              <th className="py-1 px-1.5 text-right">{t.act}</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-[#16161a]'}`}>
            {visibleFiles.map((file) => {
              const isSelected = selectedItem === file.name;
              return (
                <tr
                  key={file.name}
                  onClick={() => handleItemClick(file)}
                  className={`group cursor-pointer transition-colors ${
                    isLight
                      ? (isSelected ? 'bg-slate-200 text-slate-900 font-semibold' : 'hover:bg-slate-50 text-slate-700')
                      : (isSelected ? 'bg-[#1c1c22] text-white font-medium' : 'hover:bg-[#121215] text-zinc-400')
                  }`}
                >
                  <td className="py-1 px-2.5 flex items-center gap-1.5">
                    {file.isDirectory ? (
                      <span className={`font-bold ${isLight ? 'text-slate-600' : 'text-zinc-500'}`}>[D]</span>
                    ) : (
                      <span className={isLight ? 'text-slate-400' : 'text-zinc-600'}>[F]</span>
                    )}
                    <span className="truncate">{file.name}</span>
                  </td>

                  <td className={`py-1 px-1.5 text-[10px] ${isLight ? 'text-slate-400' : 'text-zinc-500'}`}>
                    {file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)}K`}
                  </td>

                  <td className={`py-1 px-1.5 text-[10px] hidden md:table-cell ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
                    {file.modifiedTime}
                  </td>

                  <td className="py-1 px-1.5 text-right">
                    {file.name !== '..' && (
                      <button
                        disabled
                        onClick={(e) => e.stopPropagation()}
                        title={lang === 'zh' ? '远程删除尚未启用' : 'Remote delete is not enabled'}
                        className="opacity-0 group-hover:opacity-30 p-0.5 cursor-not-allowed"
                      >
                        <Trash2 className="w-3 h-3 text-zinc-400" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <NewFolderModal
        isOpen={isNewFolderModalOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsNewFolderModalOpen(false)}
        onCreate={handleCreateFolderSubmit}
      />
    </div>
  );
};
