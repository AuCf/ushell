import React, { useState, useEffect } from 'react';
import { AIConfig } from '../types';
import { loadStoredAIConfig, saveStoredAIConfig } from '../services/aiService';
import { Language, i18n } from '../i18n';
import { X, Settings, Key, Globe, Cpu, Check } from 'lucide-react';

interface AIConfigModalProps {
  isOpen: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
  onClose: () => void;
  onSaved: (config: AIConfig) => void;
}

export const AIConfigModal: React.FC<AIConfigModalProps> = ({ isOpen, theme = 'dark', lang = 'zh', onClose, onSaved }) => {
  const [provider, setProvider] = useState<AIConfig['provider']>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [model, setModel] = useState('deepseek-chat');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const isLight = theme === 'light';
  const t = i18n[lang];

  useEffect(() => {
    if (isOpen) {
      void loadStoredAIConfig().then(cfg => {
        setProvider(cfg.provider);
        setApiKey(cfg.apiKey);
        setBaseUrl(cfg.baseUrl);
        setModel(cfg.model);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderChange = (p: AIConfig['provider']) => {
    setProvider(p);
    if (p === 'deepseek') {
      setBaseUrl('https://api.deepseek.com/v1');
      setModel('deepseek-chat');
    } else if (p === 'openai') {
      setBaseUrl('https://api.openai.com/v1');
      setModel('gpt-4o-mini');
    } else if (p === 'claude') {
      setBaseUrl('https://api.anthropic.com/v1');
      setModel('claude-3-5-sonnet-20240620');
    } else if (p === 'ollama') {
      setBaseUrl('http://localhost:11434/v1');
      setModel('llama3');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const config: AIConfig = { provider, apiKey, baseUrl, model };
    await saveStoredAIConfig(config);
    onSaved(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 600);
  };

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
            <Settings className="w-4 h-4 text-zinc-400" />
            <span>{t.aiConfigTitle}</span>
          </div>
          <button onClick={onClose} className={`p-0.5 rounded ${isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#222228] text-zinc-500'}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
          <div>
            <label className="block text-zinc-500 text-[10px] font-bold uppercase mb-1">{t.provider}</label>
            <div className="grid grid-cols-4 gap-1">
              {(['deepseek', 'openai', 'ollama', 'custom'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleProviderChange(p)}
                  className={`py-1 rounded border text-[10px] font-mono capitalize transition-colors ${
                    provider === p 
                      ? (isLight ? 'bg-slate-900 border-slate-900 text-white font-bold' : 'bg-[#27272a] border-zinc-500 text-white font-bold') 
                      : (isLight ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200' : 'bg-[#09090b] border-[#1e1e24] text-zinc-400 hover:text-zinc-200')
                  }`}
                >
                  {p === 'deepseek' ? 'DeepSeek' : p === 'openai' ? 'OpenAI' : p === 'ollama' ? 'Ollama' : 'Custom'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-zinc-500 text-[10px] font-bold uppercase mb-1">{t.apiKey}</label>
            <div className="relative">
              <Key className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
              <input
                type="password"
                placeholder={provider === 'ollama' ? 'Ollama requires no key' : 'sk-xxxxxxxxxxxxxxxx'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 border rounded font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-500 text-[10px] font-bold uppercase mb-1">{t.baseUrl}</label>
            <div className="relative">
              <Globe className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 border rounded font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-500 text-[10px] font-bold uppercase mb-1">{t.modelName}</label>
            <div className="relative">
              <Cpu className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 border rounded font-mono text-xs focus:outline-none ${
                  isLight ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-slate-600' : 'bg-[#09090b] border-[#1e1e24] text-zinc-100 focus:border-zinc-500'
                }`}
              />
            </div>
          </div>

          {savedSuccess && (
            <div className={`p-2 border rounded text-[11px] flex items-center gap-1.5 font-bold ${
              isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
            }`}>
              <Check className="w-3.5 h-3.5" />
              <span>{lang === 'zh' ? '配置已保存！' : 'Config saved!'}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-1.5 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-[#18181c] border-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              className={`flex-1 py-1.5 border font-bold text-xs rounded transition-colors ${
                isLight ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white border-zinc-600'
              }`}
            >
              {t.saveConfig}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
