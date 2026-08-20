import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { Language } from '../i18n';
import { ConfirmModal } from './ConfirmModal';

interface TrustedHostKey {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

interface TrustedHostsModalProps {
  isOpen: boolean;
  theme: 'dark' | 'light';
  lang: Language;
  onClose: () => void;
}

export const TrustedHostsModal: React.FC<TrustedHostsModalProps> = ({ isOpen, theme, lang, onClose }) => {
  const [hosts, setHosts] = useState<TrustedHostKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TrustedHostKey | null>(null);
  const isLight = theme === 'light';

  const loadHosts = async () => {
    setLoading(true);
    setError('');
    try {
      setHosts(await invoke<TrustedHostKey[]>('list_trusted_hosts'));
    } catch (reason) {
      setError(typeof reason === 'string' ? reason : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void loadHosts();
  }, [isOpen]);

  if (!isOpen) return null;

  const deleteHost = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await invoke('delete_trusted_host', { host: target.host, port: target.port });
      setHosts(current => current.filter(item => !(item.host === target.host && item.port === target.port)));
    } catch (reason) {
      setError(typeof reason === 'string' ? reason : String(reason));
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className={`w-full max-w-2xl overflow-hidden rounded-xl border shadow-2xl ${
        isLight ? 'border-slate-200 bg-white text-slate-800' : 'border-[#29292f] bg-[#121215] text-zinc-200'
      }`}>
        <div className={`flex h-11 items-center justify-between border-b px-4 ${
          isLight ? 'border-slate-200 bg-slate-50' : 'border-[#26262c] bg-[#17171b]'
        }`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {lang === 'zh' ? '已信任主机' : 'Trusted hosts'}
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-500/10 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] min-h-[220px] overflow-auto p-4 font-mono text-xs">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {lang === 'zh' ? '正在读取...' : 'Loading...'}
            </div>
          ) : hosts.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-zinc-500">
              {lang === 'zh' ? '还没有已信任的 SSH 主机' : 'No trusted SSH hosts yet'}
            </div>
          ) : (
            <div className={`divide-y rounded-lg border ${isLight ? 'divide-slate-200 border-slate-200' : 'divide-[#26262c] border-[#26262c]'}`}>
              {hosts.map(host => (
                <div key={`${host.host}:${host.port}`} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-semibold">{host.host}:{host.port}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] ${isLight ? 'border-slate-200 text-slate-500' : 'border-[#303038] text-zinc-500'}`}>
                        {host.algorithm}
                      </span>
                    </div>
                    <div className={`break-all text-[10px] leading-4 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                      SHA-256 {host.fingerprint}
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingDelete(host)}
                    className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-500"
                    title={lang === 'zh' ? '清除信任' : 'Remove trust'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-500">{error}</div>}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        theme={theme}
        lang={lang}
        title={lang === 'zh' ? '清除主机信任' : 'Remove host trust'}
        message={lang === 'zh'
          ? `清除 ${pendingDelete?.host}:${pendingDelete?.port} 的已保存指纹？下次连接时会重新要求确认。`
          : `Remove the saved fingerprint for ${pendingDelete?.host}:${pendingDelete?.port}? You will be asked to verify it next time.`}
        confirmText={lang === 'zh' ? '清除信任' : 'Remove'}
        cancelText={lang === 'zh' ? '取消' : 'Cancel'}
        isDanger
        onConfirm={() => void deleteHost()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};
