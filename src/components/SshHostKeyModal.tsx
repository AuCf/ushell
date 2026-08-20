import React, { useEffect, useRef } from 'react';
import { Fingerprint, Server, ShieldCheck, X } from 'lucide-react';
import { Language } from '../i18n';
import { UnknownHostKey } from '../services/sshTrustService';

interface SshHostKeyModalProps {
  hostKey: UnknownHostKey | null;
  theme: 'dark' | 'light';
  lang: Language;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SshHostKeyModal: React.FC<SshHostKeyModalProps> = ({
  hostKey,
  theme,
  lang,
  onConfirm,
  onCancel
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const isLight = theme === 'light';

  useEffect(() => {
    if (!hostKey) return;
    confirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hostKey, onCancel]);

  if (!hostKey) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssh-host-key-title"
    >
      <div className={`w-full max-w-lg overflow-hidden rounded-2xl border shadow-[0_24px_90px_rgba(0,0,0,0.55)] ${
        isLight
          ? 'border-slate-200 bg-white text-slate-900'
          : 'border-[#303038] bg-[#121215] text-zinc-100'
      }`}>
        <div className={`relative border-b px-5 pb-4 pt-5 ${
          isLight ? 'border-slate-200 bg-slate-50' : 'border-[#28282f] bg-[#17171b]'
        }`}>
          <div className="flex items-start gap-3 pr-8">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              isLight
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-400'
            }`}>
              <Fingerprint className="h-5 w-5" />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {lang === 'zh' ? '首次连接验证' : 'First connection check'}
              </div>
              <h2 id="ssh-host-key-title" className="text-base font-semibold tracking-tight">
                {lang === 'zh' ? '确认服务器身份' : 'Verify server identity'}
              </h2>
              <p className={`mt-1 text-xs leading-5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                {lang === 'zh'
                  ? '这是首次连接到此服务器。请核对主机密钥指纹，避免连接到错误的主机。'
                  : 'This is your first connection to this server. Verify its host key fingerprint before continuing.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={lang === 'zh' ? '取消连接' : 'Cancel connection'}
            className={`absolute right-4 top-4 rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/60 ${
              isLight ? 'text-slate-400 hover:bg-slate-200 hover:text-slate-700' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className={`grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border px-4 py-3 ${
            isLight ? 'border-slate-200 bg-white' : 'border-[#292930] bg-[#0d0d10]'
          }`}>
            <div className="flex min-w-0 items-center gap-3">
              <Server className={`h-4 w-4 shrink-0 ${isLight ? 'text-slate-400' : 'text-zinc-500'}`} />
              <div className="min-w-0">
                <div className={`font-mono text-[9px] font-bold uppercase tracking-widest ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
                  {lang === 'zh' ? '目标服务器' : 'Target host'}
                </div>
                <div className="truncate font-mono text-sm font-semibold">{hostKey.host}:{hostKey.port}</div>
              </div>
            </div>
            <div className={`rounded-md border px-2 py-1 font-mono text-[10px] font-semibold ${
              isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-[#303038] bg-[#18181d] text-zinc-400'
            }`}>
              {hostKey.algorithm}
            </div>
          </div>

          <div>
            <div className={`mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest ${
              isLight ? 'text-slate-500' : 'text-zinc-500'
            }`}>
              <ShieldCheck className="h-3.5 w-3.5" /> SHA-256 {lang === 'zh' ? '指纹' : 'fingerprint'}
            </div>
            <div className={`select-text break-all rounded-xl border px-4 py-3 font-mono text-[11px] leading-6 tracking-[0.04em] ${
              isLight
                ? 'border-slate-300 bg-slate-950 text-emerald-300'
                : 'border-emerald-500/20 bg-[#090b0a] text-emerald-400'
            }`}>
              {hostKey.fingerprint}
            </div>
          </div>

          <p className={`text-[11px] leading-5 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
            {lang === 'zh'
              ? '确认后将记住此主机。若以后主机密钥发生变化，uShell 会阻止连接并提醒你。'
              : 'uShell will remember this host. If its key changes later, the connection will be blocked and you will be warned.'}
          </p>
        </div>

        <div className={`flex items-center justify-end gap-2 border-t px-5 py-4 ${
          isLight ? 'border-slate-200 bg-slate-50' : 'border-[#28282f] bg-[#17171b]'
        }`}>
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400/50 ${
              isLight
                ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                : 'border-[#34343c] bg-[#202026] text-zinc-300 hover:bg-[#292930] hover:text-white'
            }`}
          >
            {lang === 'zh' ? '取消连接' : 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-amber-400/30 bg-amber-500 px-4 py-2 text-xs font-bold text-[#1b1405] shadow-[0_8px_24px_rgba(245,158,11,0.18)] transition-colors hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-[#17171b]"
          >
            {lang === 'zh' ? '信任并继续' : 'Trust and continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
