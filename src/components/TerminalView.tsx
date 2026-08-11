import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ServerProfile } from '../types';
import { Language, i18n } from '../i18n';
import { Sparkles, Copy, Trash2, Check, Clipboard } from 'lucide-react';

interface TerminalViewProps {
  server: ServerProfile;
  theme?: 'dark' | 'light';
  lang?: Language;
  visible?: boolean;
  onAskAIWithContext: (errorContext?: string) => void;
  pendingCommand?: string | null;
  onCommandHandled?: () => void;
  onConnectionStateChange?: (connected: boolean, error?: string) => void;
}

type TerminalEvent =
  | { type: 'connected'; banner: string; latencyMs: number }
  | { type: 'output'; data: number[] }
  | { type: 'error'; message: string }
  | { type: 'closed'; exitStatus: number | null };

const terminalTheme = (isLight: boolean): ITheme => isLight
  ? {
      background: '#ffffff',
      foreground: '#0f172a',
      cursor: '#0f172a',
      selectionBackground: 'rgba(59, 130, 246, 0.2)',
      black: '#0f172a',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#64748b'
    }
  : {
      background: '#0c0d10',
      foreground: '#e2e8f0',
      cursor: '#60a5fa',
      selectionBackground: 'rgba(59, 130, 246, 0.3)',
      black: '#1e212b',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#38bdf8',
      white: '#f8fafc'
    };

export const TerminalView: React.FC<TerminalViewProps> = ({
  server,
  theme = 'dark',
  lang = 'zh',
  visible = true,
  onAskAIWithContext,
  pendingCommand,
  onCommandHandled,
  onConnectionStateChange
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);
  const lastErrorOutput = useRef('');
  const recentOutput = useRef('');
  const connectionCallbackRef = useRef(onConnectionStateChange);
  const commandHandledRef = useRef(onCommandHandled);
  const pendingCommandRef = useRef(pendingCommand);
  const visibleRef = useRef(visible);
  const inputChainRef = useRef<Promise<void>>(Promise.resolve());

  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const isLight = theme === 'light';
  const t = i18n[lang];
  connectionCallbackRef.current = onConnectionStateChange;
  commandHandledRef.current = onCommandHandled;
  pendingCommandRef.current = pendingCommand;
  visibleRef.current = visible;

  const sendTerminalData = (data: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !connectedRef.current || !data) return false;
    inputChainRef.current = inputChainRef.current
      .then(() => invoke<void>('write_ssh_terminal', { sessionId, data }))
      .catch((reason) => {
        if (sessionIdRef.current !== sessionId || !connectedRef.current || !xtermRef.current) return;
        const message = typeof reason === 'string' ? reason : String(reason);
        connectedRef.current = false;
        lastErrorOutput.current = message;
        xtermRef.current.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        connectionCallbackRef.current?.(false, message);
      });
    return true;
  };

  useEffect(() => {
    const term = xtermRef.current;
    if (term) term.options.theme = terminalTheme(isLight);
  }, [isLight]);

  useEffect(() => {
    if (!visible || !fitAddonRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch (error) {}
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    if (!terminalRef.current) return;
    let cancelled = false;
    let openedSessionId: string | null = null;
    connectedRef.current = false;
    recentOutput.current = '';
    lastErrorOutput.current = '';

    const term = new XTerm({
      fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      theme: terminalTheme(theme === 'light')
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    term.focus();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    term.writeln(`\x1b[36mConnecting to ${server.username}@${server.host}:${server.port} via SSH PTY...\x1b[0m`);

    const outputDecoder = new TextDecoder();
    const eventChannel = new Channel<TerminalEvent>();
    eventChannel.onmessage = (event) => {
      if (cancelled) return;
      if (event.type === 'connected') {
        connectedRef.current = true;
        connectionCallbackRef.current?.(true);
        term.writeln(`\x1b[32m✔ SSH PTY connected (${event.banner}, ${event.latencyMs}ms)\x1b[0m`);
        const command = pendingCommandRef.current;
        if (command && sendTerminalData(command)) commandHandledRef.current?.();
        return;
      }
      if (event.type === 'output') {
        const bytes = new Uint8Array(event.data);
        term.write(bytes);
        recentOutput.current = `${recentOutput.current}${outputDecoder.decode(bytes, { stream: true })}`.slice(-12000);
        return;
      }
      if (event.type === 'error') {
        connectedRef.current = false;
        lastErrorOutput.current = event.message;
        term.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
        connectionCallbackRef.current?.(false, event.message);
        return;
      }
      connectedRef.current = false;
      const status = event.exitStatus == null ? '' : ` (${event.exitStatus})`;
      term.writeln(`\r\n\x1b[33m[SSH session closed${status}]\x1b[0m`);
      connectionCallbackRef.current?.(false);
    };

    const openTerminal = async () => {
      try {
        const sessionId = await invoke<string>('open_ssh_terminal', {
          host: server.host,
          port: Number(server.port),
          username: server.username,
          password: server.authType === 'password' ? (server.password || null) : null,
          privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
          authType: server.authType,
          cols: term.cols,
          rows: term.rows,
          onEvent: eventChannel
        });
        openedSessionId = sessionId;
        if (cancelled) {
          void invoke('close_ssh_terminal', { sessionId });
        } else {
          sessionIdRef.current = sessionId;
          const command = pendingCommandRef.current;
          if (connectedRef.current && command && sendTerminalData(command)) {
            commandHandledRef.current?.();
          }
        }
      } catch (reason) {
        if (cancelled) return;
        const message = typeof reason === 'string' ? reason : String(reason);
        lastErrorOutput.current = message;
        term.writeln(`\x1b[31m${message}\x1b[0m`);
        connectionCallbackRef.current?.(false, message);
      }
    };
    void openTerminal();

    const dataDisposable = term.onData((data) => {
      if (!sendTerminalData(data)) term.write('\x07');
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current;
      if (sessionId && connectedRef.current) {
        void invoke('resize_ssh_terminal', { sessionId, cols, rows });
      }
    });
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown'
        && event.ctrlKey
        && !event.shiftKey
        && event.key.toLowerCase() === 'c'
        && term.hasSelection()
      ) {
        void navigator.clipboard.writeText(term.getSelection());
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        return false;
      }
      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      try { fitAddon.fit(); } catch (error) {}
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      cancelled = true;
      connectedRef.current = false;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      const sessionId = sessionIdRef.current || openedSessionId;
      sessionIdRef.current = null;
      if (sessionId) void invoke('close_ssh_terminal', { sessionId });
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    server.id,
    server.host,
    server.port,
    server.username,
    server.authType,
    server.password,
    server.privateKey
  ]);

  useEffect(() => {
    if (!pendingCommand) return;
    if (sendTerminalData(pendingCommand)) onCommandHandled?.();
  }, [pendingCommand]);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleCopySelection = () => {
    const selection = xtermRef.current?.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
    setContextMenu(null);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      sendTerminalData(text);
      xtermRef.current?.focus();
    } catch (error) {}
    setContextMenu(null);
  };

  return (
    <div
      className={`flex-1 flex flex-col font-mono text-xs overflow-hidden relative ${
        isLight ? 'bg-white text-slate-900' : 'bg-[#0c0d10] text-[#e2e8f0]'
      }`}
      onContextMenu={handleContextMenu}
    >
      <div className={`h-7 px-3 flex items-center justify-between border-b text-xs font-sans text-[11px] select-none ${
        isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-600' : 'bg-[#14161b] border-[#22252e] text-slate-400'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
            {server.username}@{server.host}:{server.port}
          </span>
          <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 rounded font-mono">
            SSH PTY
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onAskAIWithContext(lastErrorOutput.current || recentOutput.current || `SSH session on ${server.host}:${server.port}`)}
            className={`flex items-center gap-1 px-2 py-0.5 border rounded text-[10px] ${
              isLight ? 'bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100' : 'bg-[#1f1d2b] hover:bg-[#2b273d] border-purple-500/30 text-purple-300'
            }`}
          >
            <Sparkles className="w-3 h-3 text-purple-500" />
            {t.aiDiagnose}
          </button>

          <button
            onClick={handleCopySelection}
            className={`p-1 rounded transition-colors ${
              isLight ? 'hover:bg-slate-200 text-slate-600' : 'hover:bg-[#22252e] text-slate-400 hover:text-slate-200'
            }`}
            title="复制选中的文本 (Ctrl+C)"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>

          <button
            onClick={() => xtermRef.current?.clear()}
            className={`p-1 rounded transition-colors ${
              isLight ? 'hover:bg-slate-200 text-slate-600 hover:text-red-500' : 'hover:bg-[#22222e] text-slate-400 hover:text-red-400'
            }`}
            title="清除本地滚屏内容"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-2 overflow-hidden" ref={terminalRef} />

      {contextMenu && (
        <div
          className={`fixed z-50 rounded border shadow-2xl py-1 font-mono text-xs min-w-[120px] select-none ${
            isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#121215] border-[#24242a] text-zinc-200'
          }`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleCopySelection}
            className={`w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors ${
              isLight ? 'hover:bg-slate-100' : 'hover:bg-[#18181c]'
            }`}
          >
            <Copy className="w-3 h-3 text-zinc-400" />
            <span>{lang === 'zh' ? '复制 (Copy)' : 'Copy'}</span>
          </button>
          <button
            onClick={handlePasteClipboard}
            className={`w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors ${
              isLight ? 'hover:bg-slate-100' : 'hover:bg-[#18181c]'
            }`}
          >
            <Clipboard className="w-3 h-3 text-zinc-400" />
            <span>{lang === 'zh' ? '粘贴 (Paste)' : 'Paste'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
