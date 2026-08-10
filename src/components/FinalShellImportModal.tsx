import React, { useState } from 'react';
import { parseFinalShellConfig } from '../services/finalshellImporter';
import { ServerProfile } from '../types';
import { Language, i18n } from '../i18n';
import { X, Download, CheckCircle2 } from 'lucide-react';

interface FinalShellImportModalProps {
  isOpen: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  onClose: () => void;
  onImportSuccess: (profiles: ServerProfile[]) => void;
}

export const FinalShellImportModal: React.FC<FinalShellImportModalProps> = ({
  isOpen,
  theme = 'dark',
  lang = 'zh',
  onClose,
  onImportSuccess
}) => {
  const [rawText, setRawText] = useState('');
  const [parsedCount, setParsedCount] = useState<number | null>(null);

  const isLight = theme === 'light';
  const t = i18n[lang];

  if (!isOpen) return null;

  const handleParse = () => {
    if (!rawText.trim()) return;
    const profiles = parseFinalShellConfig(rawText);
    setParsedCount(profiles.length);
    if (profiles.length > 0) {
      setTimeout(() => {
        onImportSuccess(profiles);
        onClose();
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 font-mono">
      <div className={`w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden select-none transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#24242a] text-zinc-200'
      }`}>
        {/* Header */}
        <div className={`p-3 border-b flex items-center justify-between font-bold text-xs ${
          isLight ? 'bg-[#f1f5f9] border-slate-200 text-slate-900' : 'bg-[#0e0e11] border-[#1a1a1e] text-zinc-200'
        }`}>
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-zinc-400" />
            <span>{t.importTitle}</span>
          </div>
          <button onClick={onClose} className={`p-0.5 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#222228] text-zinc-500'}`}>
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 text-xs">
          <p className={isLight ? 'text-slate-600' : 'text-zinc-400'}>
            {t.importDesc}
          </p>

          <textarea
            rows={7}
            placeholder={lang === 'zh' ? `支持导入格式:\n1. FinalShell 导出的 conn.json 文件内容\n2. 纯文本列表:\nroot@192.168.1.101:22\ndeploy@47.98.120.88:22022` : `Supported formats:\n1. FinalShell conn.json JSON string\n2. Plain text lines:\nroot@192.168.1.101:22\ndeploy@47.98.120.88:22022`}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className={`w-full border rounded-lg p-3 font-mono text-[11px] focus:outline-none ${
              isLight 
                ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-slate-600' 
                : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 placeholder-zinc-700 focus:border-zinc-500'
            }`}
          />

          {parsedCount !== null && (
            <div className={`p-2 border rounded-lg flex items-center gap-2 font-bold ${
              isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>{lang === 'zh' ? `成功解析并导入 ${parsedCount} 台服务器！` : `Parsed & imported ${parsedCount} server nodes!`}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className={`flex-1 py-1.5 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.cancel}
            </button>
            <button
              onClick={handleParse}
              disabled={!rawText.trim()}
              className={`flex-1 py-1.5 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white border-zinc-600'
              }`}
            >
              {t.parseImport}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
