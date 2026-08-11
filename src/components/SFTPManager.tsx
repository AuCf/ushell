import React, { useEffect, useRef, useState } from 'react';
import { SFTPItem, ServerProfile } from '../types';
import { NewFolderModal } from './NewFolderModal';
import { Language, i18n } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';

const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

interface SFTPManagerProps {
  server: ServerProfile;
  theme?: 'dark' | 'light';
  lang?: Language;
}

interface SftpDirectoryResult {
  path: string;
  items: SFTPItem[];
}

interface SftpDownloadResult {
  name: string;
  content: number[];
}

interface SftpUploadBatchResult {
  uploaded: number;
  directories: number;
}

interface UploadEntry {
  file: File;
  relativePath: string;
}

interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface DroppedFileEntry extends DroppedEntry {
  file: (success: (file: File) => void, error: (reason: unknown) => void) => void;
}

interface DroppedDirectoryReader {
  readEntries: (success: (entries: DroppedEntry[]) => void, error: (reason: unknown) => void) => void;
}

interface DroppedDirectoryEntry extends DroppedEntry {
  createReader: () => DroppedDirectoryReader;
}

const droppedRelativePath = (entry: DroppedEntry) => entry.fullPath.replace(/^\/+/, '') || entry.name;

const readDroppedFile = (entry: DroppedFileEntry) => new Promise<File>((resolve, reject) => {
  entry.file(resolve, reject);
});

const readAllDirectoryEntries = async (reader: DroppedDirectoryReader) => {
  const entries: DroppedEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
};

const collectDroppedEntry = async (
  entry: DroppedEntry,
  files: UploadEntry[],
  directories: string[]
): Promise<void> => {
  if (entry.isFile) {
    files.push({
      file: await readDroppedFile(entry as DroppedFileEntry),
      relativePath: droppedRelativePath(entry)
    });
    return;
  }
  if (!entry.isDirectory) return;

  directories.push(droppedRelativePath(entry));
  const children = await readAllDirectoryEntries((entry as DroppedDirectoryEntry).createReader());
  for (const child of children) await collectDroppedEntry(child, files, directories);
};

export const SFTPManager: React.FC<SFTPManagerProps> = ({ server, theme = 'dark', lang = 'zh' }) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<SFTPItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [transfer, setTransfer] = useState<{
    kind: 'upload' | 'download';
    fileName: string;
    completed?: number;
    total?: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const requestSequence = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeUploadRef = useRef<(paths: string[]) => Promise<void>>(async () => undefined);

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

  const uploadFile = async (relativePath: string, content: number[], overwrite: boolean) => {
    await invoke('upload_sftp_file', {
      ...connectionArgs(),
      parentPath: currentPath,
      relativePath,
      content,
      overwrite
    });
  };

  const uploadEntries = async (entries: UploadEntry[], directories: string[]) => {
    if (transfer || (entries.length === 0 && directories.length === 0)) return;
    const oversized = entries.find(({ file }) => file.size > MAX_TRANSFER_BYTES);
    if (oversized) {
      setError(lang === 'zh' ? '单个上传文件不能超过 64 MB' : 'A single upload cannot exceed 64 MB');
      return;
    }

    setError('');
    let completed = 0;
    try {
      if (directories.length > 0) {
        setTransfer({ kind: 'upload', fileName: directories[0], completed, total: entries.length });
        await invoke('create_sftp_directory_tree', {
          ...connectionArgs(),
          parentPath: currentPath,
          directories
        });
      }

      for (const { file, relativePath } of entries) {
        setTransfer({ kind: 'upload', fileName: relativePath, completed, total: entries.length });
        const content = Array.from(new Uint8Array(await file.arrayBuffer()));
        try {
          await uploadFile(relativePath, content, false);
        } catch (err: any) {
          const message = typeof err === 'string' ? err : (err?.message || String(err));
          if (!message.startsWith('SFTP_FILE_EXISTS:')) throw err;

          const shouldOverwrite = window.confirm(
            lang === 'zh'
              ? `远程目录中已存在 ${relativePath}，是否覆盖？`
              : `${relativePath} already exists remotely. Overwrite it?`
          );
          if (!shouldOverwrite) continue;
          await uploadFile(relativePath, content, true);
        }
        completed += 1;
      }
      await loadDirectory(currentPath);
    } catch (err: any) {
      const message = typeof err === 'string' ? err : (err?.message || String(err));
      setError(completed > 0 && lang === 'zh' ? `已上传 ${completed} 个文件，随后失败：${message}` : message);
    } finally {
      setTransfer(null);
    }
  };

  const uploadLocalPaths = async (paths: string[]) => {
    if (transfer || paths.length === 0) return;
    const label = paths.length === 1
      ? paths[0].split(/[\\/]/).pop() || paths[0]
      : (lang === 'zh' ? `${paths.length} 个项目` : `${paths.length} items`);
    setTransfer({ kind: 'upload', fileName: label });
    setError('');
    try {
      const invokeUpload = (overwrite: boolean) => invoke<SftpUploadBatchResult>('upload_sftp_local_paths', {
        ...connectionArgs(),
        parentPath: currentPath,
        localPaths: paths,
        overwrite
      });
      try {
        await invokeUpload(false);
      } catch (err: any) {
        const message = typeof err === 'string' ? err : (err?.message || String(err));
        if (!message.startsWith('SFTP_FILES_EXIST:')) throw err;
        const conflictNames = message.slice('SFTP_FILES_EXIST:'.length);
        const shouldOverwrite = window.confirm(
          lang === 'zh'
            ? `下列远程文件已经存在：\n${conflictNames}\n\n是否全部覆盖？`
            : `These remote files already exist:\n${conflictNames}\n\nOverwrite all of them?`
        );
        if (!shouldOverwrite) return;
        await invokeUpload(true);
      }
      await loadDirectory(currentPath);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    } finally {
      setTransfer(null);
    }
  };

  nativeUploadRef.current = uploadLocalPaths;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const registerNativeDrop = async () => {
      const scaleFactor = await getCurrentWindow().scaleFactor();
      const removeListener = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'leave') {
          setIsDragging(false);
          return;
        }

        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = payload.position.x / scaleFactor;
        const y = payload.position.y / scaleFactor;
        const isInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

        if (payload.type === 'drop') {
          setIsDragging(false);
          if (isInside) void nativeUploadRef.current(payload.paths);
          return;
        }
        setIsDragging(isInside);
      });

      if (cancelled) removeListener();
      else unlisten = removeListener;
    };

    void registerNativeDrop().catch((reason) => {
      if (!cancelled) setError(typeof reason === 'string' ? reason : String(reason));
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleUploadSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await uploadEntries([{ file, relativePath: file.name }], []);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (Array.from(event.dataTransfer.types).includes('Files')) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (transfer) return;

    const entries: UploadEntry[] = [];
    const directories: string[] = [];
    const droppedEntries: DroppedEntry[] = [];
    try {
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind !== 'file') continue;
        const droppedEntry = (item as DataTransferItem & {
          webkitGetAsEntry?: () => DroppedEntry | null;
        }).webkitGetAsEntry?.();
        if (droppedEntry) {
          droppedEntries.push(droppedEntry);
        } else {
          const file = item.getAsFile();
          if (file) entries.push({ file, relativePath: file.name });
        }
      }
      for (const droppedEntry of droppedEntries) {
        await collectDroppedEntry(droppedEntry, entries, directories);
      }
      await uploadEntries(entries, directories);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    }
  };

  const handleDownload = async (file: SFTPItem, event: React.MouseEvent) => {
    event.stopPropagation();
    if (file.isDirectory || transfer) return;

    setTransfer({ kind: 'download', fileName: file.name });
    setError('');
    try {
      const result = await invoke<SftpDownloadResult>('download_sftp_file', {
        ...connectionArgs(),
        path: file.path
      });
      const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(result.content)], {
        type: 'application/octet-stream'
      }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = result.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    } finally {
      setTransfer(null);
    }
  };

  return (
    <div
      ref={rootRef}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative h-full border-l flex flex-col font-mono text-[11px] select-none ${
      isLight ? 'bg-white border-slate-200 text-slate-700' : 'bg-[#0a0a0c] border-[#1a1a1e] text-zinc-300'
    }`}
    >
      {isDragging && (
        <div className={`absolute inset-2 z-30 pointer-events-none border-2 border-dashed rounded flex items-center justify-center text-sm font-bold ${
          isLight
            ? 'bg-blue-50/95 border-blue-500 text-blue-700'
            : 'bg-[#101827]/95 border-blue-400 text-blue-300'
        }`}>
          {lang === 'zh' ? '松开即可上传文件或整个目录' : 'Drop to upload files or folders'}
        </div>
      )}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(transfer)}
            title={lang === 'zh' ? '上传文件到当前远程目录（最大 64 MB）' : 'Upload to this remote directory (64 MB max)'}
            className={`px-1.5 py-0.5 border rounded text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {transfer?.kind === 'upload' ? (lang === 'zh' ? '上传中' : 'UPLOADING') : t.upload}
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

      {transfer && (
        <div className={`px-2.5 py-1.5 border-b flex items-center gap-1.5 text-[10px] ${
          isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-950/30 border-blue-900 text-blue-300'
        }`}>
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate">
            {transfer.kind === 'upload'
              ? (lang === 'zh'
                ? `正在上传 ${transfer.fileName}${transfer.total ? `（${transfer.completed}/${transfer.total}）` : ''}`
                : `Uploading ${transfer.fileName}${transfer.total ? ` (${transfer.completed}/${transfer.total})` : ''}`)
              : (lang === 'zh' ? `正在下载 ${transfer.fileName}` : `Downloading ${transfer.fileName}`)}
          </span>
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
                      <div className="flex items-center justify-end gap-0.5">
                        {!file.isDirectory && (
                          <button
                            onClick={(event) => handleDownload(file, event)}
                            disabled={Boolean(transfer)}
                            title={lang === 'zh' ? `下载 ${file.name}` : `Download ${file.name}`}
                            className={`opacity-0 group-hover:opacity-100 p-0.5 rounded disabled:opacity-30 ${
                              isLight ? 'hover:bg-slate-300 text-slate-500' : 'hover:bg-[#27272a] text-zinc-500 hover:text-zinc-200'
                            }`}
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          disabled
                          onClick={(e) => e.stopPropagation()}
                          title={lang === 'zh' ? '远程删除尚未启用' : 'Remote delete is not enabled'}
                          className="opacity-0 group-hover:opacity-30 p-0.5 cursor-not-allowed"
                        >
                          <Trash2 className="w-3 h-3 text-zinc-400" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUploadSelection}
      />

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
