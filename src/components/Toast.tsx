import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        onClose();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-9 right-4 bg-[#121215] border border-[#27272a] text-zinc-200 px-3 py-2 rounded-md shadow-2xl z-50 font-mono text-xs flex items-center gap-2 animate-in slide-in-from-bottom duration-150 select-none">
      {toast.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
      {toast.type === 'info' && <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
      {toast.type === 'warning' && <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
      {toast.type === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}

      <span>{toast.text}</span>

      <button onClick={onClose} className="p-0.5 hover:bg-[#222228] rounded text-zinc-500 hover:text-zinc-300 ml-2">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
