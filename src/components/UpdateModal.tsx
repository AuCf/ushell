import React, { useState } from 'react';
import { ReleaseInfo, CURRENT_VERSION } from '../services/updaterService';
import { Language } from '../i18n';
import { X, Sparkles, Download, ExternalLink, CheckCircle2, ArrowRight, FolderDown } from 'lucide-react';

interface UpdateModalProps {
  isOpen: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  releaseInfo: ReleaseInfo | null;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  theme = 'dark',
  lang = 'zh',
  releaseInfo,
  onClose
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateComplete, setUpdateComplete] = useState(false);

  const isLight = theme === 'light';

  if (!isOpen || !releaseInfo) return null;

  const triggerDownload = (url?: string) => {
    const targetUrl = url || releaseInfo.downloadUrl || releaseInfo.htmlUrl;
    if (!targetUrl) return;

    // Create a temporary anchor element to force browser download / navigation
    const link = document.createElement('a');
    link.href = targetUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleStartHotUpdate = () => {
    if (updateComplete) {
      triggerDownload();
      return;
    }

    setIsUpdating(true);
    setProgress(10);

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setUpdateComplete(true);
          // Automatically trigger download
          triggerDownload();
          return 100;
        }
        return prev + Math.floor(Math.random() * 20) + 10;
      });
    }, 150);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 font-mono select-none">
      <div className={`w-full max-w-md rounded-xl border shadow-2xl overflow-hidden transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#27272a] text-zinc-200'
      }`}>
        {/* Header */}
        <div className={`p-3 border-b flex items-center justify-between font-bold text-xs ${
          isLight ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-[#1a170d] border-amber-900/40 text-amber-400'
        }`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>{lang === 'zh' ? '检测到新版本可用！' : 'New Update Available!'}</span>
          </div>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-amber-500/20 text-amber-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs">
          
          {/* Version Diff Badge */}
          <div className={`p-3 rounded-lg border flex items-center justify-between ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#09090b] border-[#1e1e24]'
          }`}>
            <div className="flex items-center gap-2 font-mono">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px]">v{CURRENT_VERSION}</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold text-xs">v{releaseInfo.version}</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">{releaseInfo.publishedAt}</span>
          </div>

          {/* Release Notes */}
          <div className="space-y-1.5">
            <p className={`font-bold text-[11px] ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
              {lang === 'zh' ? '📋 更新日志 / Release Notes:' : '📋 Release Notes:'}
            </p>
            <div className={`p-3 border rounded-lg max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[11px] font-mono ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-[#09090c] border-[#18181c] text-zinc-400'
            }`}>
              {releaseInfo.body || (lang === 'zh' ? '特性更新与缺陷修复。' : 'Performance enhancements and bug fixes.')}
            </div>
          </div>

          {/* Download Progress Bar */}
          {isUpdating && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                <span className="text-amber-400 flex items-center gap-1.5">
                  {!updateComplete ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                      {lang === 'zh' ? '正在获取并下载最新热更新包...' : 'Fetching hot update package...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{lang === 'zh' ? '安装包下载链接已拉起！点击下方按钮直接下载覆盖升级' : 'Update package ready for install!'}</span>
                    </>
                  )}
                </span>
                <span className={updateComplete ? 'text-emerald-400' : 'text-amber-400'}>{progress}%</span>
              </div>

              {/* Progress Track */}
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-150 ${updateComplete ? 'bg-emerald-500' : 'bg-amber-400'}`}
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className={`px-3 py-2 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {lang === 'zh' ? '稍后再说' : 'Later'}
            </button>

            <a
              href={releaseInfo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className={`px-3 py-2 border font-bold text-xs rounded transition-colors flex items-center justify-center gap-1 ${
                isLight ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200' : 'bg-[#1e1e24] border-[#2c2c36] text-zinc-300 hover:text-white'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </a>

            <button
              onClick={handleStartHotUpdate}
              className={`flex-1 py-2 rounded font-extrabold text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-lg ${
                updateComplete 
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-950/40' 
                  : 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-950/40'
              }`}
            >
              {updateComplete ? <FolderDown className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
              <span>{updateComplete ? (lang === 'zh' ? '点击直接下载安装包' : 'DOWNLOAD PACKAGE') : (lang === 'zh' ? '一键热更新升级' : 'HOT UPDATE NOW')}</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
