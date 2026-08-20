import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ServerProfile, SystemMetrics } from '../types';
import { Language } from '../i18n';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ServerMonitorProps {
  server: ServerProfile;
  active: boolean;
  theme?: 'dark' | 'light';
  lang?: Language;
}

interface MetricsResponse extends Omit<SystemMetrics, 'netRxKbps' | 'netTxKbps'> {
  netRxBytes: number;
  netTxBytes: number;
}

interface NetworkSample {
  timestamp: number;
  rx: number;
  tx: number;
}

export const ServerMonitor: React.FC<ServerMonitorProps> = ({ server, active, theme = 'dark', lang = 'zh' }) => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const previousNetwork = useRef<NetworkSample | null>(null);

  const isLight = theme === 'light';

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let polling = false;

    const collect = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await invoke<MetricsResponse>('get_server_metrics', {
          host: server.host,
          port: Number(server.port),
          username: server.username,
          password: server.authType === 'password' ? (server.password || null) : null,
          privateKey: server.authType === 'privateKey' ? (server.privateKey || null) : null,
          authType: server.authType
        });
        if (cancelled) return;
        const now = Date.now();
        const previous = previousNetwork.current;
        const elapsedSeconds = previous ? Math.max((now - previous.timestamp) / 1000, 0.001) : 0;
        const netRxKbps = previous ? Math.max(0, (result.netRxBytes - previous.rx) / 1024 / elapsedSeconds) : 0;
        const netTxKbps = previous ? Math.max(0, (result.netTxBytes - previous.tx) / 1024 / elapsedSeconds) : 0;
        previousNetwork.current = { timestamp: now, rx: result.netRxBytes, tx: result.netTxBytes };
        setMetrics({ ...result, netRxKbps, netTxKbps });
        setError('');
      } catch (reason) {
        if (!cancelled) setError(typeof reason === 'string' ? reason : String(reason));
      } finally {
        polling = false;
      }
    };

    void collect();
    const timer = window.setInterval(() => void collect(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      previousNetwork.current = null;
    };
  }, [active, server.id, server.host, server.port, server.username, server.authType, server.password, server.privateKey]);

  return (
    <div className={`border-t font-mono text-[11px] select-none z-10 transition-colors ${
      isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-600' : 'bg-[#0c0c0e] border-[#1a1a1e] text-zinc-500'
    }`}>
      <div className="px-2.5 h-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-1.5 py-0.2 font-bold text-[9px] uppercase tracking-wider rounded-sm ${
            error
              ? 'bg-red-500/15 text-red-500'
              : metrics
                ? (isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-950/50 text-emerald-400')
                : (isLight ? 'bg-slate-300 text-slate-700' : 'bg-[#27272a] text-zinc-400')
          }`} title={error || undefined}>
            {error ? (lang === 'zh' ? '不可用' : 'UNAVAILABLE') : metrics ? 'LIVE' : (lang === 'zh' ? '采集中' : 'LOADING')}
          </span>
          <span className={`font-medium truncate ${isLight ? 'text-slate-800' : 'text-zinc-300'}`}>{server.name}</span>
        </div>

        {metrics && (
          <div className="flex items-center gap-4 text-[10px]">
            <div><span>CPU: </span><span className={metrics.cpuUsage > 80 ? 'text-red-500 font-bold' : (isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300')}>{metrics.cpuUsage.toFixed(0)}%</span></div>
            <div><span>MEM: </span><span className={isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300'}>{(metrics.memoryUsedMB / 1024).toFixed(1)}G/{(metrics.memoryTotalMB / 1024).toFixed(1)}G</span></div>
            <div className="hidden sm:block"><span>DISK: </span><span className={isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300'}>{metrics.diskUsage.toFixed(0)}%</span></div>
            <div className="hidden md:flex items-center gap-1.5"><span>NET: </span><span className="text-emerald-600 font-semibold">↓{metrics.netRxKbps.toFixed(0)}K</span><span className={isLight ? 'text-blue-600' : 'text-zinc-400'}>↑{metrics.netTxKbps.toFixed(0)}K</span></div>
          </div>
        )}

        <button
          onClick={() => setIsExpanded(current => !current)}
          disabled={!metrics}
          className={`flex items-center gap-0.5 text-[10px] disabled:opacity-30 ${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <span>PS</span>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
      </div>

      {isExpanded && metrics && (
        <div className={`p-2 border-t text-[10px] ${isLight ? 'bg-white border-slate-200' : 'bg-[#09090b] border-[#1a1a1e]'}`}>
          <table className="w-full text-left">
            <thead><tr className={`border-b ${isLight ? 'text-slate-400 border-slate-200' : 'text-zinc-600 border-[#1a1a1e]'}`}><th className="py-0.5">PID</th><th className="py-0.5">PROCESS</th><th className="py-0.5 text-right">CPU</th><th className="py-0.5 text-right">MEM</th></tr></thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-[#16161a]'}`}>
              {metrics.topProcesses.map(proc => (
                <tr key={proc.pid} className={isLight ? 'text-slate-700' : 'text-zinc-400'}>
                  <td className="py-0.5 opacity-60">{proc.pid}</td><td className="py-0.5 font-semibold">{proc.name}</td><td className="py-0.5 text-right text-emerald-600 font-bold">{proc.cpu}%</td><td className="py-0.5 text-right opacity-80">{proc.mem}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
