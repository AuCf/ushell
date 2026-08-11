import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ServerProfile } from '../types';
import { Language, i18n } from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, Copy, Trash2, Check, Clipboard } from 'lucide-react';

interface TerminalViewProps {
  server: ServerProfile;
  theme?: 'dark' | 'light';
  lang?: Language;
  onAskAIWithContext: (errorContext?: string) => void;
  pendingCommand?: string | null;
  onCommandHandled?: () => void;
  onConnectionStateChange?: (connected: boolean, error?: string) => void;
}

interface SshCommandResult {
  stdout: string;
  stderr: string;
  exit_status: number;
  current_dir: string;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  server,
  theme = 'dark',
  lang = 'zh',
  onAskAIWithContext,
  pendingCommand,
  onCommandHandled,
  onConnectionStateChange
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const currentLineBuffer = useRef('');
  const currentDir = useRef('~');
  const commandHistory = useRef<string[]>([]);
  const historyIdx = useRef<number>(-1);
  const lastErrorOutput = useRef<string>('');
  const isConnected = useRef(false);
  const isExecuting = useRef(false);
  const isCompleting = useRef(false);

  const isLight = theme === 'light';
  const t = i18n[lang];

  const promptPrefix = () => {
    return `\x1b[1;32m${server.username}@${server.host}\x1b[0m:\x1b[1;34m${currentDir.current}\x1b[0m$ `;
  };

  const redrawCurrentInput = (term: XTerm, line: string) => {
    term.write(`\r\x1b[2K${promptPrefix()}${line}`);
  };

  const longestCommonPrefix = (values: string[]) => {
    if (values.length === 0) return '';
    let prefix = values[0];
    for (let index = 1; index < values.length && prefix; index += 1) {
      while (!values[index].startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
  };

  const completeCurrentInput = async (term: XTerm) => {
    if (!isConnected.current || isExecuting.current || isCompleting.current) {
      term.write('\x07');
      return;
    }

    const lineSnapshot = currentLineBuffer.current;
    const token = lineSnapshot.match(/[^\s]*$/)?.[0] || '';
    isCompleting.current = true;
    try {
      const candidates = await invoke<string[]>('complete_ssh_input', {
        host: server.host,
        port: Number(server.port),
        username: server.username,
        password: server.authType === 'password' ? (server.password || null) : null,
        privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
        authType: server.authType,
        line: lineSnapshot,
        currentDir: currentDir.current
      });
      if (currentLineBuffer.current !== lineSnapshot) return;
      if (candidates.length === 0) {
        term.write('\x07');
        return;
      }

      const commonPrefix = longestCommonPrefix(candidates);
      if (candidates.length === 1 || commonPrefix.length > token.length) {
        const completedToken = candidates.length === 1 ? candidates[0] : commonPrefix;
        const suffix = candidates.length === 1 && !completedToken.endsWith('/') ? ' ' : '';
        const completedLine = `${lineSnapshot.slice(0, lineSnapshot.length - token.length)}${completedToken}${suffix}`;
        currentLineBuffer.current = completedLine;
        redrawCurrentInput(term, completedLine);
        return;
      }

      term.writeln('');
      term.writeln(candidates.join('  '));
      term.write(promptPrefix() + currentLineBuffer.current);
    } catch (err: any) {
      const message = typeof err === 'string' ? err : (err?.message || String(err));
      term.writeln('');
      term.writeln(`\x1b[31m${message}\x1b[0m`);
      term.write(promptPrefix() + currentLineBuffer.current);
    } finally {
      isCompleting.current = false;
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;
    let isCancelled = false;
    isConnected.current = false;
    isExecuting.current = false;
    currentDir.current = '~';

    const termTheme = isLight
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

    const term = new XTerm({
      fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: termTheme
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    try {
      term.writeln(`\x1b[36mConnecting to ${server.username}@${server.host}:${server.port} via SSH2 (VT100 PTY)... \x1b[0m`);
    } catch (e) {}

    // Safe Real Native SSH Verification Check
    const runRealSshCheck = async () => {
      try {
        const res = await invoke<{ success: boolean; latency_ms: number; banner: string }>('test_ssh_connection', {
          host: server.host,
          port: Number(server.port),
          username: server.username,
          password: server.password || null,
          privateKey: server.privateKey || null,
          authType: server.authType
        });

        if (!isCancelled && xtermRef.current) {
          isConnected.current = true;
          onConnectionStateChange?.(true);
          term.writeln(`\x1b[32m✔ Authenticated via SSH2 (${res.banner}). Latency: ${res.latency_ms}ms\x1b[0m`);
          term.write(promptPrefix());
        }
      } catch (err: any) {
        if (!isCancelled && xtermRef.current) {
          isConnected.current = false;
          const errMsg = typeof err === 'string' ? err : (err?.message || String(err));
          onConnectionStateChange?.(false, errMsg);
          term.writeln(`\x1b[31m${errMsg}\x1b[0m`);
          term.writeln(`\x1b[33m[MaShell SSH Alert] Connection attempt failed for host ${server.host}:${server.port}\x1b[0m\r\n`);
          lastErrorOutput.current = errMsg;
        }
      }
    };

    runRealSshCheck();

    const handleResize = () => {
      try {
        if (!isCancelled && fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      } catch (e) {}
    };
    window.addEventListener('resize', handleResize);

    // Keystroke Stream Handler
    const dataDisposable = term.onData((data) => {
      if (isCancelled || !xtermRef.current) return;

      if (data === '\r' || data === '\n') {
        term.writeln('');
        const cmd = currentLineBuffer.current.trim();
        if (cmd) {
          commandHistory.current.push(cmd);
          historyIdx.current = -1;
          executeCommand(term, cmd);
        } else {
          term.write(promptPrefix());
        }
        currentLineBuffer.current = '';
      } else if (data === '\x7f' || data === '\b') {
        if (currentLineBuffer.current.length > 0) {
          currentLineBuffer.current = currentLineBuffer.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data === '\x03') {
        if (term.hasSelection()) {
          const selection = term.getSelection();
          navigator.clipboard.writeText(selection);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else {
          term.writeln('^C');
          currentLineBuffer.current = '';
          term.write(promptPrefix());
        }
      } else if (data === '\x0c') {
        term.clear();
        term.write(promptPrefix() + currentLineBuffer.current);
      } else if (data === '\t') {
        void completeCurrentInput(term);
      } else if (data === '\x1b[A') {
        if (commandHistory.current.length > 0) {
          const nextIdx = historyIdx.current < commandHistory.current.length - 1 ? historyIdx.current + 1 : historyIdx.current;
          historyIdx.current = nextIdx;
          const histCmd = commandHistory.current[commandHistory.current.length - 1 - nextIdx] || '';
          clearLineInput(term);
          currentLineBuffer.current = histCmd;
          term.write(histCmd);
        }
      } else if (data === '\x1b[B') {
        if (historyIdx.current > 0) {
          const nextIdx = historyIdx.current - 1;
          historyIdx.current = nextIdx;
          const histCmd = commandHistory.current[commandHistory.current.length - 1 - nextIdx] || '';
          clearLineInput(term);
          currentLineBuffer.current = histCmd;
          term.write(histCmd);
        } else if (historyIdx.current === 0) {
          historyIdx.current = -1;
          clearLineInput(term);
          currentLineBuffer.current = '';
        }
      } else if (data >= ' ') {
        currentLineBuffer.current += data;
        term.write(data);
      }
    });

    return () => {
      isCancelled = true;
      window.removeEventListener('resize', handleResize);
      try { dataDisposable.dispose(); } catch (e) {}
      try { term.dispose(); } catch (e) {}
      xtermRef.current = null;
    };
  }, [server, theme]);

  const handlePasteEvent = async (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && xtermRef.current) {
      currentLineBuffer.current += pastedText;
      xtermRef.current.write(pastedText);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCopySelection = () => {
    if (xtermRef.current) {
      const selection = xtermRef.current.getSelection() || currentLineBuffer.current;
      if (selection) {
        navigator.clipboard.writeText(selection);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
    setContextMenu(null);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && xtermRef.current) {
        currentLineBuffer.current += text;
        xtermRef.current.write(text);
      }
    } catch (err) {}
    setContextMenu(null);
  };

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  useEffect(() => {
    if (pendingCommand && xtermRef.current) {
      clearLineInput(xtermRef.current);
      currentLineBuffer.current = pendingCommand;
      xtermRef.current.write(pendingCommand);
      xtermRef.current.focus();
      onCommandHandled?.();
    }
  }, [pendingCommand]);

  const clearLineInput = (term: XTerm) => {
    while (currentLineBuffer.current.length > 0) {
      try { term.write('\b \b'); } catch (e) {}
      currentLineBuffer.current = currentLineBuffer.current.slice(0, -1);
    }
  };

  const executeCommand = async (term: XTerm, cmd: string) => {
    const mainCmd = cmd.trim().split(/\s+/)[0].toLowerCase();

    if (mainCmd === 'clear' || mainCmd === 'cls') {
      term.clear();
      term.write(promptPrefix());
      return;
    }

    if (mainCmd === 'history') {
      commandHistory.current.forEach((h, i) => {
        term.writeln(`  \x1b[33m${i + 1}\x1b[0m  ${h}`);
      });
      term.write(promptPrefix());
      return;
    }

    if (!isConnected.current) {
      term.writeln(`\x1b[31mSSH 尚未通过认证，请检查服务器配置后重新连接。\x1b[0m`);
      return;
    }
    if (isExecuting.current) {
      term.writeln(`\x1b[33m上一条远程命令仍在执行，请稍候。\x1b[0m`);
      term.write(promptPrefix());
      return;
    }

    isExecuting.current = true;
    try {
      const result = await invoke<SshCommandResult>('execute_ssh_command', {
        host: server.host,
        port: Number(server.port),
        username: server.username,
        password: server.authType === 'password' ? (server.password || null) : null,
        privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
        authType: server.authType,
        command: cmd,
        currentDir: currentDir.current
      });

      currentDir.current = result.current_dir || currentDir.current;
      if (result.stdout) term.writeln(result.stdout.replace(/\r?\n/g, '\r\n'));
      if (result.stderr) {
        const errorOutput = result.stderr.replace(/\r?\n/g, '\r\n');
        term.writeln(`\x1b[31m${errorOutput}\x1b[0m`);
        lastErrorOutput.current = result.stderr;
      }
      if (result.exit_status !== 0 && !result.stderr) {
        const statusMessage = `远程命令退出状态: ${result.exit_status}`;
        term.writeln(`\x1b[31m${statusMessage}\x1b[0m`);
        lastErrorOutput.current = statusMessage;
      }
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : (err?.message || String(err));
      term.writeln(`\x1b[31m${errMsg}\x1b[0m`);
      lastErrorOutput.current = errMsg;
    } finally {
      isExecuting.current = false;
      term.write(promptPrefix());
    }
  };

  return (
    <div 
      className={`flex-1 flex flex-col font-mono text-xs overflow-hidden relative ${
        isLight ? 'bg-white text-slate-900' : 'bg-[#0c0d10] text-[#e2e8f0]'
      }`}
      onPaste={handlePasteEvent}
      onContextMenu={handleContextMenu}
    >
      {/* Terminal Bar */}
      <div className={`h-7 px-3 flex items-center justify-between border-b text-xs font-sans text-[11px] select-none ${
        isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-600' : 'bg-[#14161b] border-[#22252e] text-slate-400'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{server.username}@{server.host}:{server.port}</span>
          <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 rounded font-mono">SSH EXEC</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onAskAIWithContext(lastErrorOutput.current || `Permission denied on ${server.host}:${server.port}`)}
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
            onClick={() => {
              if (xtermRef.current) {
                xtermRef.current.clear();
                xtermRef.current.write(promptPrefix());
              }
            }}
            className={`p-1 rounded transition-colors ${
              isLight ? 'hover:bg-slate-200 text-slate-600 hover:text-red-500' : 'hover:bg-[#22222e] text-slate-400 hover:text-red-400'
            }`}
            title="清屏 (Ctrl+L)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* xterm.js Canvas Container */}
      <div className="flex-1 p-2 overflow-hidden" ref={terminalRef} />

      {/* Terminal Right-Click Context Menu */}
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
