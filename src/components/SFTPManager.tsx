import React, { useEffect, useRef, useState } from 'react';
import { SFTPItem, ServerProfile } from '../types';
import { NewFolderModal } from './NewFolderModal';
import { ConfirmModal } from './ConfirmModal';
import { Language, i18n } from '../i18n';
import { Channel, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Download, Eye, EyeOff, FolderUp, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { filterSftpItems } from '../services/sftpView';

const formatTransferSize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
const isTransferCancelled = (reason: unknown) => String(reason).includes('SFTP_TRANSFER_CANCELLED');

interface SFTPManagerProps {
  server: ServerProfile;
  theme?: 'dark' | 'light';
  lang?: Language;
}

interface SftpDirectoryResult {
  path: string;
  items: SFTPItem[];
}

interface SftpUploadBatchResult {
  uploaded: number;
  directories: number;
}

interface SftpTransferEvent {
  transferred: number;
  total: number;
  fileName: string;
}

interface ConfirmDialogState {
  title?: string;
  message: string;
  confirmText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface TransferState {
  kind: 'upload' | 'download' | 'delete';
  fileName: string;
  completed?: number;
  total?: number;
  taskId?: string;
}

export const SFTPManager: React.FC<SFTPManagerProps> = ({ server, theme = 'dark', lang = 'zh' }) => {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<SFTPItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const requestSequence = useRef(0);
  const sftpSessionIdRef = useRef<string | null>(null);
  const transferRef = useRef<TransferState | null>(null);
  const confirmPendingRef = useRef(false);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const directoryCacheRef = useRef(new Map<string, SftpDirectoryResult>());
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeUploadRef = useRef<(paths: string[]) => Promise<void>>(async () => undefined);

  const replaceTransfer = (next: TransferState | null) => {
    transferRef.current = next;
    setTransfer(next);
  };

  const beginTransfer = (next: TransferState): boolean => {
    if (transferRef.current) return false;
    replaceTransfer(next);
    return true;
  };

  const updateTransfer = (taskId: string, update: (current: TransferState) => TransferState) => {
    const current = transferRef.current;
    if (!current || current.taskId !== taskId) return;
    replaceTransfer(update(current));
  };

  const finishTransfer = (taskId?: string) => {
    const current = transferRef.current;
    if (!current || (taskId && current.taskId !== taskId)) return;
    replaceTransfer(null);
  };

  const isLight = theme === 'light';
  const t = i18n[lang];

  const askConfirmation = (
    message: string,
    title?: string,
    isDanger = false,
    confirmText?: string
  ): Promise<boolean> => {
    if (confirmPendingRef.current) return Promise.resolve(false);
    confirmPendingRef.current = true;
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      const settle = (confirmed: boolean) => {
        confirmPendingRef.current = false;
        confirmResolverRef.current = null;
        setConfirmDialog(null);
        resolve(confirmed);
      };
      setConfirmDialog({
        title,
        message,
        confirmText,
        isDanger,
        onConfirm: () => settle(true),
        onCancel: () => settle(false)
      });
    });
  };

  const connectionArgs = () => ({
    host: server.host,
    port: Number(server.port),
    username: server.username,
    password: server.authType === 'password' ? (server.password || null) : null,
    privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
    authType: server.authType
  });

  const sessionArgs = () => {
    const sessionId = sftpSessionIdRef.current;
    if (!sessionId) throw new Error(lang === 'zh' ? 'SFTP 会话尚未连接' : 'SFTP session is not connected');
    return { sessionId };
  };

  const applyDirectory = (result: SftpDirectoryResult) => {
    setCurrentPath(result.path);
    setFiles(result.items.map(item => ({
      ...item,
      modifiedTime: /^\d+$/.test(item.modifiedTime)
        ? new Date(Number(item.modifiedTime) * 1000).toLocaleString()
        : (item.modifiedTime || '-')
    })));
    setSelectedItem(null);
  };

  const loadDirectory = async (
    requestedPath: string,
    sessionId = sftpSessionIdRef.current,
    forceRefresh = false
  ) => {
    const requestId = ++requestSequence.current;
    setError('');
    const cached = !forceRefresh ? directoryCacheRef.current.get(requestedPath) : undefined;
    if (cached) {
      applyDirectory(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    try {
      if (!sessionId) throw new Error(lang === 'zh' ? 'SFTP 会话尚未连接' : 'SFTP session is not connected');
      const result = await invoke<SftpDirectoryResult>('list_sftp_directory', {
        sessionId,
        path: requestedPath
      });
      if (requestId !== requestSequence.current) return;

      directoryCacheRef.current.set(requestedPath, result);
      directoryCacheRef.current.set(result.path, result);
      applyDirectory(result);
    } catch (err: any) {
      if (requestId !== requestSequence.current) return;
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let ownedSessionId: string | null = null;
    requestSequence.current += 1;
    sftpSessionIdRef.current = null;
    directoryCacheRef.current.clear();
    setCurrentPath('.');
    setFiles([]);
    setShowHiddenFiles(false);
    setError('');
    setIsLoading(true);

    const connect = async () => {
      try {
        const sessionId = await invoke<string>('open_sftp_session', connectionArgs());
        ownedSessionId = sessionId;
        if (cancelled) {
          void invoke('close_sftp_session', { sessionId });
          return;
        }
        sftpSessionIdRef.current = sessionId;
        await loadDirectory('.', sessionId);
      } catch (err: any) {
        if (cancelled) return;
        setError(typeof err === 'string' ? err : (err?.message || String(err)));
        setIsLoading(false);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      requestSequence.current += 1;
      const activeTaskId = transferRef.current?.taskId;
      if (activeTaskId) void invoke('cancel_sftp_transfer', { taskId: activeTaskId });
      transferRef.current = null;
      confirmPendingRef.current = false;
      confirmResolverRef.current?.(false);
      confirmResolverRef.current = null;
      if (sftpSessionIdRef.current === ownedSessionId) sftpSessionIdRef.current = null;
      if (ownedSessionId) void invoke('close_sftp_session', { sessionId: ownedSessionId });
    };
  }, [server.id, server.host, server.port, server.username, server.authType, server.password, server.privateKey]);

  const parentPath = currentPath === '/'
    ? null
    : (currentPath.slice(0, currentPath.lastIndexOf('/')) || '/');
  const filteredFiles = filterSftpItems(files, showHiddenFiles);
  const visibleFiles: SFTPItem[] = parentPath
    ? [{
        name: '..',
        path: parentPath,
        isDirectory: true,
        size: 0,
        modifiedTime: '-',
        permissions: 'drwxr-xr-x'
      }, ...filteredFiles]
    : filteredFiles;

  const handleItemClick = (item: SFTPItem) => {
    if (transferRef.current) return;
    setSelectedItem(item.name);
    if (item.isDirectory) {
      loadDirectory(item.path);
    }
  };

  const handleCreateFolderSubmit = async (folderName: string) => {
    if (transferRef.current) return;
    setError('');
    try {
      await invoke('create_sftp_directory', {
        ...sessionArgs(),
        parentPath: currentPath,
        folderName
      });
      await loadDirectory(currentPath, undefined, true);
    } catch (err: any) {
      if (!isTransferCancelled(err)) {
        setError(typeof err === 'string' ? err : (err?.message || String(err)));
      }
    }
  };

  const uploadLocalPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    const label = paths.length === 1
      ? paths[0].split(/[\\/]/).pop() || paths[0]
      : (lang === 'zh' ? `${paths.length} 个项目` : `${paths.length} items`);
    if (!beginTransfer({ kind: 'upload', fileName: label, completed: 0, total: 0 })) return;
    const uploadParentPath = currentPath;
    let activeTaskId: string | undefined;
    setError('');
    try {
      const invokeUpload = (overwrite: boolean) => {
        const taskId = crypto.randomUUID();
        activeTaskId = taskId;
        const onEvent = new Channel<SftpTransferEvent>();
        onEvent.onmessage = event => updateTransfer(taskId, current => ({
          ...current,
          taskId,
          fileName: event.fileName,
          completed: event.transferred,
          total: event.total
        }));
        replaceTransfer({ kind: 'upload', fileName: label, taskId, completed: 0, total: 0 });
        return invoke<SftpUploadBatchResult>('upload_sftp_local_paths', {
          ...sessionArgs(),
          taskId,
          parentPath: uploadParentPath,
          localPaths: paths,
          overwrite,
          onEvent
        });
      };
      try {
        await invokeUpload(false);
      } catch (err: any) {
        const message = typeof err === 'string' ? err : (err?.message || String(err));
        if (!message.startsWith('SFTP_FILES_EXIST:')) throw err;
        const conflictNames = message.slice('SFTP_FILES_EXIST:'.length);
        const shouldOverwrite = await askConfirmation(
          lang === 'zh'
            ? `下列远程文件已经存在：\n${conflictNames}\n\n是否全部覆盖？`
            : `These remote files already exist:\n${conflictNames}\n\nOverwrite all of them?`,
          lang === 'zh' ? '批量覆盖确认' : 'Confirm Batch Overwrite'
        );
        if (!shouldOverwrite) return;
        await invokeUpload(true);
      }
      await loadDirectory(uploadParentPath, undefined, true);
    } catch (err: any) {
      if (!isTransferCancelled(err)) {
        setError(typeof err === 'string' ? err : (err?.message || String(err)));
      }
    } finally {
      finishTransfer(activeTaskId);
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

  const selectUploadPaths = async (directory: boolean) => {
    if (transferRef.current) return;
    const selected = await open({ multiple: !directory, directory });
    if (!selected) return;
    await uploadLocalPaths(Array.isArray(selected) ? selected : [selected]);
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

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    // Desktop drops are handled by Tauri's native path event above so every
    // file and directory uses the same streaming backend path.
  };

  const handleDownload = async (file: SFTPItem, event: React.MouseEvent) => {
    event.stopPropagation();
    if (transferRef.current) return;

    const suggestedName = file.isDirectory ? `${file.name}.tar.gz` : file.name;
    const localPath = await save({ defaultPath: suggestedName });
    if (!localPath) return;
    const taskId = crypto.randomUUID();
    const onEvent = new Channel<SftpTransferEvent>();
    onEvent.onmessage = progress => updateTransfer(taskId, current => ({
      ...current,
      fileName: progress.fileName,
      completed: progress.transferred,
      total: progress.total
    }));
    if (!beginTransfer({ kind: 'download', fileName: file.name, taskId, completed: 0, total: file.isDirectory ? 0 : file.size })) return;
    setError('');
    try {
      await invoke(
        file.isDirectory ? 'download_sftp_directory' : 'download_sftp_file',
        {
          ...sessionArgs(),
          taskId,
          path: file.path,
          localPath,
          onEvent
        }
      );
    } catch (err: any) {
      if (!isTransferCancelled(err)) {
        setError(typeof err === 'string' ? err : (err?.message || String(err)));
      }
    } finally {
      finishTransfer(taskId);
    }
  };

  const cancelTransfer = () => {
    const taskId = transferRef.current?.taskId;
    if (!taskId) return;
    void invoke('cancel_sftp_transfer', { taskId });
  };

  const handleDelete = async (file: SFTPItem, event: React.MouseEvent) => {
    event.stopPropagation();
    if (transferRef.current) return;

    const confirmed = await askConfirmation(
      file.isDirectory
        ? (lang === 'zh'
          ? `将递归删除远程目录“${file.name}”及其中全部内容。此操作无法撤销，确定继续吗？`
          : `Delete the remote folder “${file.name}” and everything inside it? This cannot be undone.`)
        : (lang === 'zh'
          ? `确定删除远程文件“${file.name}”吗？此操作无法撤销。`
          : `Delete the remote file “${file.name}”? This cannot be undone.`),
      lang === 'zh' ? '删除确认' : 'Confirm deletion',
      true,
      lang === 'zh' ? '确认删除' : 'Delete'
    );
    if (!confirmed) return;

    if (!beginTransfer({ kind: 'delete', fileName: file.name })) return;
    setError('');
    try {
      await invoke('delete_sftp_path', {
        ...sessionArgs(),
        path: file.path
      });
      setSelectedItem(null);
      await loadDirectory(currentPath, undefined, true);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || String(err)));
    } finally {
      finishTransfer();
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
            disabled={Boolean(transfer)}
            className={`px-1.5 py-0.5 border rounded transition-colors text-[10px] ${
              isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {t.mkdir}
          </button>

          <button
            onClick={() => void selectUploadPaths(false)}
            disabled={Boolean(transfer)}
            title={lang === 'zh' ? '流式上传一个或多个文件' : 'Stream one or more files'}
            className={`px-1.5 py-0.5 border rounded text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {transfer?.kind === 'upload' ? (lang === 'zh' ? '上传中' : 'UPLOADING') : t.upload}
          </button>

          <button
            onClick={() => void selectUploadPaths(true)}
            disabled={Boolean(transfer)}
            title={lang === 'zh' ? '流式上传整个目录' : 'Stream a folder'}
            className={`p-1 border rounded transition-colors disabled:opacity-50 ${
              isLight ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-white'
            }`}
          >
            <FolderUp className="w-3 h-3" />
          </button>

          <button
            onClick={() => setShowHiddenFiles(current => !current)}
            aria-pressed={showHiddenFiles}
            className={`p-1 border rounded transition-colors ${
              showHiddenFiles
                ? (isLight ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-blue-950/40 border-blue-700 text-blue-300')
                : (isLight ? 'bg-white border-slate-300 text-slate-500 hover:text-slate-800' : 'bg-[#18181c] border-[#27272a] text-zinc-500 hover:text-zinc-300')
            }`}
            title={showHiddenFiles
              ? (lang === 'zh' ? '隐藏以 . 开头的文件和目录' : 'Hide dotfiles and hidden folders')
              : (lang === 'zh' ? '显示以 . 开头的文件和目录' : 'Show dotfiles and hidden folders')}
          >
            {showHiddenFiles ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>

          <button
            onClick={() => loadDirectory(currentPath, undefined, true)}
            disabled={isLoading || Boolean(transfer)}
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
          <div className="min-w-0 flex-1">
          <span className="block truncate">
            {transfer.kind === 'upload'
              ? (lang === 'zh'
                ? `正在上传 ${transfer.fileName}${transfer.total ? `（${formatTransferSize(transfer.completed || 0)} / ${formatTransferSize(transfer.total)}）` : ''}`
                : `Uploading ${transfer.fileName}${transfer.total ? ` (${formatTransferSize(transfer.completed || 0)} / ${formatTransferSize(transfer.total)})` : ''}`)
              : transfer.kind === 'download'
                ? (lang === 'zh'
                  ? `正在下载 ${transfer.fileName}${transfer.total ? `（${formatTransferSize(transfer.completed || 0)} / ${formatTransferSize(transfer.total)}）` : ''}`
                  : `Downloading ${transfer.fileName}${transfer.total ? ` (${formatTransferSize(transfer.completed || 0)} / ${formatTransferSize(transfer.total)})` : ''}`)
                : (lang === 'zh' ? `正在删除 ${transfer.fileName}` : `Deleting ${transfer.fileName}`)}
          </span>
          {transfer.total ? (
            <div className="mt-1 h-1 overflow-hidden rounded bg-current/15">
              <div className="h-full bg-current transition-[width]" style={{ width: `${Math.min(100, ((transfer.completed || 0) / transfer.total) * 100)}%` }} />
            </div>
          ) : null}
          </div>
          {transfer.taskId && (
            <button onClick={cancelTransfer} className="rounded p-0.5 hover:bg-current/10" title={lang === 'zh' ? '取消传输' : 'Cancel transfer'}>
              <X className="h-3 w-3" />
            </button>
          )}
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
                        <button
                          onClick={(event) => handleDownload(file, event)}
                          disabled={Boolean(transfer)}
                          title={lang === 'zh'
                            ? `${file.isDirectory ? '打包下载目录' : '下载'} ${file.name}`
                            : `${file.isDirectory ? 'Download folder' : 'Download'} ${file.name}`}
                          className={`opacity-0 group-hover:opacity-100 p-0.5 rounded disabled:opacity-30 ${
                            isLight ? 'hover:bg-slate-300 text-slate-500' : 'hover:bg-[#27272a] text-zinc-500 hover:text-zinc-200'
                          }`}
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(event) => handleDelete(file, event)}
                          disabled={Boolean(transfer)}
                          title={lang === 'zh' ? `删除 ${file.name}` : `Delete ${file.name}`}
                          className={`opacity-0 group-hover:opacity-100 p-0.5 rounded disabled:opacity-30 ${
                            isLight ? 'hover:bg-red-100 text-red-500' : 'hover:bg-red-950/50 text-red-400'
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
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

      <NewFolderModal
        isOpen={isNewFolderModalOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsNewFolderModalOpen(false)}
        onCreate={handleCreateFolderSubmit}
      />

      {confirmDialog && (
        <ConfirmModal
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          theme={theme}
          lang={lang}
          isDanger={confirmDialog.isDanger}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      )}
    </div>
  );
};
