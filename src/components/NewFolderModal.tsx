import React, { useState } from 'react';
import { X, FolderPlus } from 'lucide-react';
import { Language, i18n } from '../i18n';

interface NewFolderModalProps {
  isOpen: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  onClose: () => void;
  onCreate: (folderName: string) => void;
}

export const NewFolderModal: React.FC<NewFolderModalProps> = ({ isOpen, theme = 'dark', lang = 'zh', onClose, onCreate }) => {
  const [folderName, setFolderName] = useState('');

  const isLight = theme === 'light';
  const t = i18n[lang];

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    onCreate(folderName.trim());
    setFolderName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 font-mono">
      <div className={`w-full max-w-sm rounded-lg border shadow-2xl overflow-hidden select-none transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#24242a] text-zinc-200'
      }`}>
        <div className={`p-3 border-b flex items-center justify-between font-bold text-xs ${
          isLight ? 'bg-[#f1f5f9] border-slate-200 text-slate-900' : 'bg-[#0e0e11] border-[#1a1a1e] text-zinc-200'
        }`}>
          <div className="flex items-center gap-2">
            <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t.createDir}</span>
          </div>
          <button onClick={onClose} className={`p-0.5 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#222228] text-zinc-500'}`}>
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-3.5 space-y-3 text-xs">
          <div>
            <label className="block text-zinc-500 text-[10px] uppercase font-bold mb-1">{t.folderName}</label>
            <input
              type="text"
              autoFocus
              required
              placeholder={lang === 'zh' ? '例如: my-app-service' : 'e.g. my-app-service'}
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              className={`w-full border rounded px-2.5 py-1.5 font-mono text-xs focus:outline-none ${
                isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
              }`}
            />
          </div>

          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-1 border font-bold text-[11px] rounded transition-colors ${
                isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              className={`flex-1 py-1 border font-bold text-[11px] rounded transition-colors ${
                isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white border-zinc-600'
              }`}
            >
              {t.createDir}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
