import { ServerProfile, SFTPItem, SystemMetrics } from '../types';

export const INITIAL_SERVERS: ServerProfile[] = [];

export const INITIAL_SFTP_FILES: SFTPItem[] = [
  { name: '..', path: '/var', isDirectory: true, size: 0, modifiedTime: '2026-08-10 12:00', permissions: 'drwxr-xr-x', owner: 'root' },
  { name: 'app', path: '/var/www/app', isDirectory: true, size: 4096, modifiedTime: '2026-08-10 14:20', permissions: 'drwxr-xr-x', owner: 'www-data' },
  { name: 'logs', path: '/var/www/logs', isDirectory: true, size: 4096, modifiedTime: '2026-08-10 16:00', permissions: 'drwxr-xr-x', owner: 'www-data' },
  { name: 'docker-compose.yml', path: '/var/www/docker-compose.yml', isDirectory: false, size: 1842, modifiedTime: '2026-08-09 18:20', permissions: '-rwxr-xr-x', owner: 'root' },
  { name: 'config.json', path: '/var/www/config.json', isDirectory: false, size: 520, modifiedTime: '2026-08-10 11:15', permissions: '-rw-r--r--', owner: 'root' },
  { name: '.env', path: '/var/www/.env', isDirectory: false, size: 120, modifiedTime: '2026-08-01 09:00', permissions: '-rw-------', owner: 'root' }
];

export function generateDynamicMetrics(prev?: SystemMetrics): SystemMetrics {
  const baseCpu = prev ? prev.cpuUsage : 35;
  const cpuDelta = (Math.random() - 0.5) * 8;
  const newCpu = Math.min(99, Math.max(5, Math.round(baseCpu + cpuDelta)));

  const baseMem = prev ? prev.memoryUsedMB : 6800;
  const memDelta = (Math.random() - 0.5) * 120;
  const newMem = Math.min(15800, Math.max(2000, Math.round(baseMem + memDelta)));

  return {
    timestamp: Date.now(),
    cpuUsage: newCpu,
    cpuCores: 8,
    memoryTotalMB: 16384,
    memoryUsedMB: newMem,
    memoryUsage: Math.round((newMem / 16384) * 100),
    diskUsedGB: 248,
    diskTotalGB: 500,
    diskUsage: 48,
    netRxKbps: Math.floor(Math.random() * 450) + 50,
    netTxKbps: Math.floor(Math.random() * 850) + 120,
    topProcesses: [
      { pid: 1428, name: 'node /app/server.js', cpu: Number((newCpu * 0.4).toFixed(1)), mem: 4.2 },
      { pid: 892, name: 'postgres: main cluster', cpu: Number((newCpu * 0.25).toFixed(1)), mem: 5.1 },
      { pid: 210, name: 'nginx: worker process', cpu: Number((newCpu * 0.1).toFixed(1)), mem: 0.8 },
      { pid: 3410, name: 'redis-server *:6379', cpu: Number((newCpu * 0.05).toFixed(1)), mem: 1.2 }
    ]
  };
}
