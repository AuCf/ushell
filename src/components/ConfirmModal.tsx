import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Language } from '../i18n';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
  theme = 'dark',
  lang = 'zh',
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  const isLight = theme === 'light';
  const defaultTitle = lang === 'zh' ? '操作确认' : 'Confirm Action';
  const defaultConfirm = lang === 'zh' ? '确定覆盖' : 'Overwrite';
  const defaultCancel = lang === 'zh' ? '取消' : 'Cancel';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className={`w-full max-w-md rounded-xl border shadow-2xl overflow-hidden font-mono text-xs ${
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#24242a] text-zinc-200'
        }`}
      >
        {/* Modal Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isLight ? 'bg-[#f8fafc] border-slate-200' : 'bg-[#18181c] border-[#24242a]'
        }`}>
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className={`w-4 h-4 ${isDanger ? 'text-amber-500' : 'text-blue-500'}`} />
            <span>{title || defaultTitle}</span>
          </div>

          <button
            onClick={onCancel}
            className={`p-1 rounded transition-colors ${
              isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#27272a] text-zinc-400 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 whitespace-pre-wrap leading-relaxed max-h-[240px] overflow-y-auto">
          {message}
        </div>

        {/* Modal Actions */}
        <div className={`px-4 py-3 border-t flex items-center justify-end gap-2 ${
          isLight ? 'bg-[#f8fafc] border-slate-200' : 'bg-[#18181c] border-[#24242a]'
        }`}>
          <button
            type="button"
            onClick={onCancel}
            className={`px-3 py-1.5 border rounded transition-colors font-medium ${
              isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#1e1e24] border-[#27272a] text-zinc-300 hover:text-white'
            }`}
          >
            {cancelText || defaultCancel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded transition-colors font-bold ${
              isDanger
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : (isLight ? 'bg-slate-900 hover:bg-slate-800 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white')
            }`}
          >
            {confirmText || defaultConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};
