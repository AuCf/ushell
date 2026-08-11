import React, { useState } from 'react';
import { AICopilotMessage, AIConfig } from '../types';
import { queryAICopilot, getStoredAIConfig } from '../services/aiService';
import { AIConfigModal } from './AIConfigModal';
import { Language, i18n } from '../i18n';
import { Terminal, Send, X, Copy, Check, Settings, CornerDownLeft, Trash2 } from 'lucide-react';

interface AICopilotProps {
  isOpen: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  onClose: () => void;
  onInsertCommandToTerminal: (command: string) => void;
  initialErrorContext?: string;
}

export const AICopilot: React.FC<AICopilotProps> = ({
  isOpen,
  theme = 'dark',
  lang = 'zh',
  onClose,
  onInsertCommandToTerminal,
  initialErrorContext
}) => {
  const t = i18n[lang];

  const [messages, setMessages] = useState<AICopilotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: lang === 'zh' ? 'AI 命令面板就绪，请输入问题或报错。' : 'AI Command Palette ready. Type a prompt or error context below.',
      timestamp: Date.now()
    }
  ]);

  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig>(getStoredAIConfig());

  const isLight = theme === 'light';

  React.useEffect(() => {
    if (initialErrorContext && isOpen) {
      handleSendPrompt(`Analyze error:\n${initialErrorContext}`, initialErrorContext);
    }
  }, [initialErrorContext, isOpen]);

  const handleSendPrompt = async (promptText: string, errorCtx?: string) => {
    if (!promptText.trim()) return;

    const userMsg: AICopilotMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: promptText,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputVal('');
    setIsLoading(true);

    try {
      const res = await queryAICopilot(promptText, errorCtx, aiConfig);
      const aiMsg: AICopilotMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: res.answer,
        suggestedCommand: res.suggestedCommand,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          id: `ai_err_${Date.now()}`,
          role: 'assistant',
          content: 'AI request failed.',
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCmd = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        role: 'assistant',
        content: lang === 'zh' ? 'AI 命令面板就绪，历史会话已清空。' : 'AI Command Palette ready. Chat history cleared.',
        timestamp: Date.now()
      }
    ]);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={`fixed right-3 top-10 bottom-8 w-80 border shadow-2xl flex flex-col z-40 font-mono text-xs select-none transition-colors ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#0d0d10] border-[#1e1e24] text-zinc-200'
      }`}>
        {/* Header */}
        <div className={`p-2 border-b flex items-center justify-between ${
          isLight ? 'bg-[#f1f5f9] border-slate-200 text-slate-700' : 'bg-[#121215] border-[#1e1e24] text-zinc-400'
        }`}>
          <div className="flex items-center gap-1.5 font-bold text-[11px]">
            <Terminal className="w-3.5 h-3.5 text-zinc-400" />
            <span className={isLight ? 'text-slate-900' : 'text-zinc-200'}>{t.cmdPalette}</span>
            <span className={`text-[9px] font-mono uppercase ${isLight ? 'text-slate-500' : 'text-zinc-600'}`}>[{aiConfig.provider}]</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleClearHistory}
              className={`p-1 rounded transition-colors ${isLight ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-900' : 'hover:bg-[#222228] text-zinc-500 hover:text-zinc-300'}`}
              title={lang === 'zh' ? '清空历史会话' : 'Clear Chat History'}
            >
              <Trash2 className="w-3 h-3 text-zinc-400 hover:text-red-400" />
            </button>
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className={`p-1 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-900' : 'hover:bg-[#222228] text-zinc-500 hover:text-zinc-300'}`}
              title={t.configKey}
            >
              <Settings className="w-3 h-3 text-zinc-400" />
            </button>
            <button onClick={onClose} className={`p-1 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#222228] text-zinc-500'}`}>
              <X className="w-3 h-3 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Message Log */}
        <div className="flex-1 p-2.5 overflow-y-auto space-y-2.5 text-[11px]">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className={`text-[9px] font-bold uppercase ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
                {msg.role === 'assistant' ? `&gt; AI (${aiConfig.model})` : '&gt; YOU'}
              </div>

              <div className={`p-2 rounded ${
                msg.role === 'user' 
                  ? (isLight ? 'bg-slate-100 text-slate-900 border border-slate-200' : 'bg-[#18181c] text-zinc-200 border border-[#27272a]') 
                  : (isLight ? 'bg-white text-slate-800 border border-slate-200' : 'bg-[#121215] text-zinc-300 border border-[#1e1e24]')
              }`}>
                <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                {msg.suggestedCommand && (
                  <div className={`mt-2 p-1.5 rounded border font-mono text-[10px] space-y-1 ${
                    isLight ? 'bg-slate-900 text-emerald-400 border-slate-900' : 'bg-[#09090b] text-emerald-400 border-[#27272a]'
                  }`}>
                    <code className="block break-all">{msg.suggestedCommand}</code>
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => onInsertCommandToTerminal(msg.suggestedCommand!)}
                        className={`flex-1 py-0.5 rounded text-[10px] flex items-center justify-center gap-1 font-bold ${
                          isLight ? 'bg-white text-slate-900 hover:bg-slate-100' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
                        }`}
                      >
                        <CornerDownLeft className="w-2.5 h-2.5" />
                        {t.runInTerm}
                      </button>
                      <button
                        onClick={() => handleCopyCmd(msg.suggestedCommand!, msg.id)}
                        className={`p-1 rounded ${isLight ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-[#18181c] hover:bg-[#222228] text-zinc-400'}`}
                      >
                        {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className={`italic text-[10px] ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>
              &gt; AI is computing command...
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt(inputVal);
          }}
          className={`p-2 border-t flex gap-1 font-mono ${
            isLight ? 'bg-[#f1f5f9] border-slate-200' : 'bg-[#121215] border-[#1e1e24]'
          }`}
        >
          <span className={`font-bold text-xs pt-1 ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>&gt;</span>
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder={lang === 'zh' ? '输入 AI 指令...' : 'Ask AI shell command...'}
            className={`flex-1 border rounded px-2 py-1 text-xs font-mono focus:outline-none ${
              isLight 
                ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-slate-600' 
                : 'bg-[#09090b] border-[#1e1e24] text-zinc-200 placeholder-zinc-700 focus:border-zinc-500'
            }`}
          />
          <button
            type="submit"
            disabled={!inputVal.trim() || isLoading}
            className={`p-1 rounded font-bold transition-colors disabled:opacity-50 ${
              isLight ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
            }`}
          >
            <Send className="w-3 h-3 text-zinc-400" />
          </button>
        </form>
      </div>

      <AIConfigModal
        isOpen={isConfigModalOpen}
        theme={theme}
        lang={lang}
        onClose={() => setIsConfigModalOpen(false)}
        onSaved={(config) => setAiConfig(config)}
      />
    </>
  );
};
