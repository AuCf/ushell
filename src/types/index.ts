export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  group?: string;
  tags?: string[];
  createdAt: number;
  lastConnectedAt?: number;
}

export interface SessionTab {
  id: string;
  serverId: string;
  title: string;
  host: string;
  connected: boolean;
  activeView: 'terminal' | 'sftp' | 'both';
  sftpOpened?: boolean;
  createdAt: number;
}

export interface SystemMetrics {
  timestamp: number;
  cpuUsage: number; // 0-100%
  cpuCores: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryUsage: number; // 0-100%
  diskUsedGB: number;
  diskTotalGB: number;
  diskUsage: number; // 0-100%
  netRxKbps: number; // Downstream rate KB/s
  netTxKbps: number; // Upstream rate KB/s
  topProcesses: {
    pid: number;
    name: string;
    cpu: number;
    mem: number;
  }[];
}

export interface SFTPItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number; // bytes
  modifiedTime: string;
  permissions: string;
  owner?: string;
}

export interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: number;
}

export interface AICopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  suggestedCommand?: string;
  timestamp: number;
}

export interface AIConfig {
  provider: 'deepseek' | 'openai' | 'claude' | 'ollama' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
}
