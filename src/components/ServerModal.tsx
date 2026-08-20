import React, { useState, useEffect, useRef } from 'react';
import { ServerProfile } from '../types';
import { Language, i18n } from '../i18n';
import { X, Server, Key, Lock, ChevronDown, Check, Wifi, AlertCircle, Loader2 } from 'lucide-react';
import { ConfirmHostKey, invokeWithHostTrust } from '../services/sshTrustService';

interface ServerModalProps {
  isOpen: boolean;
  editingServer?: ServerProfile | null;
  existingGroups?: string[];
  theme?: 'dark' | 'light';
  lang?: Language;
  onClose: () => void;
  onSave: (profile: Omit<ServerProfile, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  onConfirmHostKey: ConfirmHostKey;
}

export const ServerModal: React.FC<ServerModalProps> = ({
  isOpen,
  editingServer,
  existingGroups = ['DEFAULT', 'PROD', 'STAGING', 'DEV'],
  theme = 'dark',
  lang = 'zh',
  onClose,
  onSave,
  onConfirmHostKey
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [group, setGroup] = useState('DEFAULT');

  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testLatency, setTestLatency] = useState<number>(0);
  const [sshBanner, setSshBanner] = useState<string>('');
  const [testError, setTestError] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const groupDropdownRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';
  const t = i18n[lang];

  useEffect(() => {
    if (editingServer) {
      setName(editingServer.name);
      setHost(editingServer.host);
      setPort(editingServer.port);
      setUsername(editingServer.username);
      setAuthType(editingServer.authType);
      setPassword(editingServer.password || '');
      setPrivateKey(editingServer.privateKey || '');
      setGroup(editingServer.group || (lang === 'zh' ? '默认分组' : 'DEFAULT'));
    } else {
      setName('');
      setHost('');
      setPort(22);
      setUsername('root');
      setAuthType('password');
      setPassword('');
      setPrivateKey('');
      setGroup(existingGroups[0] || (lang === 'zh' ? '默认分组' : 'DEFAULT'));
    }
    setTestStatus('idle');
  }, [editingServer, isOpen, lang, existingGroups]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
        setIsGroupDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    const cleanHost = host.trim();
    const cleanUser = username.trim();

    if (!cleanHost) {
      setTestStatus('failed');
      setTestError(lang === 'zh' ? '请输入主机 IP 或域名！' : 'Host IP/Domain is required!');
      return;
    }

    if (port <= 0 || port > 65535) {
      setTestStatus('failed');
      setTestError(lang === 'zh' ? '无效的 SSH 端口号 (1-65535)' : 'Invalid SSH Port (1-65535)');
      return;
    }

    if (!cleanUser) {
      setTestStatus('failed');
      setTestError(lang === 'zh' ? '请填写 SSH 连接用户名！' : 'Username is required!');
      return;
    }

    if (authType === 'password') {
      if (!password) {
        setTestStatus('failed');
        setTestError(lang === 'zh' ? '未填写密码！请输入 SSH 认证密码' : 'Password missing! Enter password.');
        return;
      }
    } else {
      if (!privateKey.trim()) {
        setTestStatus('failed');
        setTestError(lang === 'zh' ? '未提供私钥！请粘贴 SSH 密钥内容' : 'Private Key missing!');
        return;
      }
    }

    setTestStatus('testing');
    setTestError('');

    try {
      // Call Native Rust SSH TCP Socket & Banner Tester
      const res = await invokeWithHostTrust<{ success: boolean; latency_ms: number; banner: string; message: string }>('test_ssh_connection', {
        host: cleanHost,
        port: Number(port),
        username: cleanUser,
        password: authType === 'password' ? password : null,
        privateKey: authType === 'privateKey' ? privateKey : null,
        authType
      }, lang, onConfirmHostKey);

      setTestLatency(res.latency_ms);
      setSshBanner(res.banner);
      setTestStatus('success');
    } catch (err: any) {
      setTestStatus('failed');
      const errStr = typeof err === 'string' ? err : (err.message || String(err));
      setTestError(errStr);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !host) return;

    setIsSaving(true);
    setTestError('');
    try {
      await onSave({
        id: editingServer?.id,
        name,
        host,
        port,
        username,
        authType,
        password,
        privateKey,
        group: group.trim() || (lang === 'zh' ? '默认分组' : 'DEFAULT'),
        tags: editingServer?.tags || ['Manual']
      });
      onClose();
    } catch (error) {
      setTestStatus('failed');
      setTestError(typeof error === 'string' ? error : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const filteredGroups = existingGroups.filter(g => 
    g.toLowerCase().includes(group.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 font-mono">
      <div className={`w-full max-w-md rounded-xl border shadow-2xl overflow-hidden select-none transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#24242a] text-zinc-200'
      }`}>
        {/* Header */}
        <div className={`p-3 border-b flex items-center justify-between font-bold text-xs ${
          isLight ? 'bg-[#f1f5f9] border-slate-200 text-slate-900' : 'bg-[#0e0e11] border-[#1a1a1e] text-zinc-200'
        }`}>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-zinc-400" />
            <span>{editingServer ? t.editHost : t.createHost}</span>
          </div>
          <button onClick={onClose} className={`p-0.5 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#222228] text-zinc-500'}`}>
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
          <div>
            <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.hostName} *</label>
            <input
              type="text"
              required
              placeholder={lang === 'zh' ? '例如: 生产 Web 服务器' : 'e.g. Production Web Node'}
              value={name}
              onChange={e => setName(e.target.value)}
              className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
              }`}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.hostIp} *</label>
              <input
                type="text"
                required
                placeholder="192.168.1.100"
                value={host}
                onChange={e => setHost(e.target.value)}
                className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
            <div>
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.port}</label>
              <input
                type="number"
                value={port}
                onChange={e => setPort(Number(e.target.value))}
                className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.user}</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>

            {/* Custom Group Dropdown */}
            <div className="relative" ref={groupDropdownRef}>
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.group}</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder={lang === 'zh' ? '选择或自定义分组' : 'Select or type group'}
                  value={group}
                  onFocus={() => setIsGroupDropdownOpen(true)}
                  onChange={e => {
                    setGroup(e.target.value);
                    setIsGroupDropdownOpen(true);
                  }}
                  className={`w-full border rounded pl-2.5 pr-6 py-1.5 font-mono text-xs focus:outline-none ${
                    isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setIsGroupDropdownOpen(!isGroupDropdownOpen)}
                  className="absolute right-1.5 top-2 p-0.5 text-zinc-500 hover:text-zinc-300"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Custom Menu Dropdown Popup */}
              {isGroupDropdownOpen && (
                <div className={`absolute left-0 right-0 top-full mt-1 max-h-36 overflow-y-auto rounded-lg border shadow-xl z-50 font-mono text-xs ${
                  isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#18181c] border-[#2a2a32] text-zinc-200'
                }`}>
                  {filteredGroups.length > 0 ? (
                    filteredGroups.map(g => (
                      <div
                        key={g}
                        onClick={() => {
                          setGroup(g);
                          setIsGroupDropdownOpen(false);
                        }}
                        className={`px-3 py-1.5 cursor-pointer flex items-center justify-between transition-colors ${
                          group === g 
                            ? (isLight ? 'bg-slate-200 font-bold' : 'bg-[#27272a] font-bold text-white')
                            : (isLight ? 'hover:bg-slate-100' : 'hover:bg-[#222228]')
                        }`}
                      >
                        <span>{g}</span>
                        {group === g && <Check className="w-3 h-3 text-emerald-500" />}
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-zinc-500 italic text-[11px]">
                      {lang === 'zh' ? '+ 保存时将自动新建此分组' : '+ Press save to create'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.authMethod}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`flex-1 py-1 rounded border text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  authType === 'password'
                    ? (isLight ? 'bg-slate-900 border-slate-900 text-white font-bold' : 'bg-[#27272a] border-zinc-500 text-white font-bold')
                    : (isLight ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200' : 'bg-[#09090b] border-[#1e1e24] text-zinc-400 hover:text-zinc-200')
                }`}
              >
                <Lock className="w-3 h-3 text-zinc-400" />
                {t.passwordAuth}
              </button>
              <button
                type="button"
                onClick={() => setAuthType('privateKey')}
                className={`flex-1 py-1 rounded border text-xs font-mono font-medium flex items-center justify-center gap-1 transition-colors ${
                  authType === 'privateKey'
                    ? (isLight ? 'bg-slate-900 border-slate-900 text-white font-bold' : 'bg-[#27272a] border-zinc-500 text-white font-bold')
                    : (isLight ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200' : 'bg-[#09090b] border-[#1e1e24] text-zinc-400 hover:text-zinc-200')
                }`}
              >
                <Key className="w-3 h-3 text-zinc-400" />
                {t.keyAuth}
              </button>
            </div>
          </div>

          {authType === 'password' ? (
            <div>
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.password}</label>
              <input
                type="password"
                placeholder={lang === 'zh' ? '请输入 SSH 密码' : 'Enter SSH Password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          ) : (
            <div>
              <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.privateKey} (PEM / OpenSSH)</label>
              <textarea
                rows={3}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={privateKey}
                onChange={e => setPrivateKey(e.target.value)}
                className={`w-full border rounded p-2 font-mono text-[10px] focus:outline-none resize-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          )}

          {/* Real Native Rust SSH Connection Test Status Banner */}
          {testStatus !== 'idle' && (
            <div className={`p-2 rounded border text-[11px] flex flex-col gap-1 ${
              testStatus === 'testing'
                ? (isLight ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-blue-950/40 border-blue-800 text-blue-300')
                : testStatus === 'success'
                ? (isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold' : 'bg-emerald-950/40 border-emerald-800 text-emerald-400 font-bold')
                : (isLight ? 'bg-red-50 border-red-200 text-red-800 font-bold' : 'bg-red-950/40 border-red-800 text-red-400 font-bold')
            }`}>
              <div className="flex items-center gap-1.5">
                {testStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                {testStatus === 'success' && <Wifi className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                {testStatus === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                <span>
                  {testStatus === 'testing'
                    ? (lang === 'zh' ? `正在进行 SSH 握手与身份认证 ${username}@${host}:${port}...` : `Authenticating SSH session ${username}@${host}:${port}...`)
                    : testStatus === 'success'
                    ? (lang === 'zh' ? `✔ SSH 身份认证成功！耗时: ${testLatency}ms` : `✔ SSH authentication succeeded! Time: ${testLatency}ms`)
                    : testError}
                </span>
              </div>
              {testStatus === 'success' && sshBanner && (
                <div className="text-[9px] font-mono opacity-80 pl-5">
                  Banner: <span className="underline">{sshBanner}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testStatus === 'testing'}
              className={`py-1.5 px-3 border font-bold text-xs rounded transition-colors flex items-center gap-1 ${
                isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100' : 'bg-[#18181c] border-[#27272a] text-zinc-300 hover:text-white'
              }`}
            >
              <Wifi className="w-3 h-3 text-zinc-400" />
              {lang === 'zh' ? '测试连接' : 'TEST PING'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className={`py-1.5 px-3 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-[#f1f5f9] border-slate-300 text-slate-700 hover:bg-slate-200' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className={`flex-1 py-1.5 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white border-zinc-600'
              }`}
            >
              {isSaving ? (lang === 'zh' ? '保存中...' : 'Saving...') : t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
