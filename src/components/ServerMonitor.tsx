import React, { useState, useEffect } from 'react';
import { SystemMetrics } from '../types';
import { generateDynamicMetrics } from '../services/mockData';
import { Language, i18n } from '../i18n';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ServerMonitorProps {
  serverName: string;
  theme?: 'dark' | 'light';
  lang?: Language;
}

export const ServerMonitor: React.FC<ServerMonitorProps> = ({ serverName, theme = 'dark' }) => {
  const [metrics, setMetrics] = useState<SystemMetrics>(generateDynamicMetrics());
  const [isExpanded, setIsExpanded] = useState(false);

  const isLight = theme === 'light';

  useEffect(() => {
    const timer = setInterval(() => {
      setMetrics(prev => generateDynamicMetrics(prev));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`border-t font-mono text-[11px] select-none z-10 transition-colors ${
      isLight ? 'bg-[#f1f5f9] border-[#e2e8f0] text-slate-600' : 'bg-[#0c0c0e] border-[#1a1a1e] text-zinc-500'
    }`}>
      {/* Statusline Bar */}
      <div className="px-2.5 h-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.2 font-bold text-[9px] uppercase tracking-wider rounded-sm ${
            isLight ? 'bg-slate-300 text-slate-800' : 'bg-[#27272a] text-zinc-200'
          }`}>
            CONNECTED
          </span>
          <span className={`font-medium ${isLight ? 'text-slate-800' : 'text-zinc-300'}`}>{serverName}</span>
        </div>

        {/* Metrics */}
        <div className="flex items-center gap-4 text-[10px]">
          <div>
            <span>CPU: </span>
            <span className={metrics.cpuUsage > 80 ? 'text-red-500 font-bold' : (isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300')}>
              {metrics.cpuUsage}%
            </span>
          </div>

          <div>
            <span>MEM: </span>
            <span className={isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300'}>
              {(metrics.memoryUsedMB / 1024).toFixed(1)}G/{(metrics.memoryTotalMB / 1024).toFixed(0)}G
            </span>
          </div>

          <div className="hidden sm:block">
            <span>DISK: </span>
            <span className={isLight ? 'text-slate-900 font-semibold' : 'text-zinc-300'}>{metrics.diskUsage}%</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5">
            <span>NET: </span>
            <span className="text-emerald-600 font-semibold">↓{metrics.netRxKbps}K</span>
            <span className={isLight ? 'text-blue-600' : 'text-zinc-400'}>↑{metrics.netTxKbps}K</span>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-0.5 text-[10px] ${
            isLight ? 'text-slate-600 hover:text-slate-900' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span>PS</span>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
      </div>

      {/* Expanded Processes */}
      {isExpanded && (
        <div className={`p-2 border-t text-[10px] ${
          isLight ? 'bg-white border-slate-200' : 'bg-[#09090b] border-[#1a1a1e]'
        }`}>
          <table className="w-full text-left">
            <thead>
              <tr className={`border-b ${isLight ? 'text-slate-400 border-slate-200' : 'text-zinc-600 border-[#1a1a1e]'}`}>
                <th className="py-0.5">PID</th>
                <th className="py-0.5">PROCESS</th>
                <th className="py-0.5 text-right">CPU</th>
                <th className="py-0.5 text-right">MEM</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-[#16161a]'}`}>
              {metrics.topProcesses.map(proc => (
                <tr key={proc.pid} className={`transition-colors ${isLight ? 'hover:bg-slate-50 text-slate-700' : 'hover:bg-[#141418] text-zinc-400'}`}>
                  <td className="py-0.5 opacity-60">{proc.pid}</td>
                  <td className={`py-0.5 font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>{proc.name}</td>
                  <td className="py-0.5 text-right text-emerald-600 font-bold">{proc.cpu}%</td>
                  <td className="py-0.5 text-right opacity-80">{proc.mem}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
