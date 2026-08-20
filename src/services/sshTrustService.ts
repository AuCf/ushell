import { invoke } from '@tauri-apps/api/core';

export interface UnknownHostKey {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

export type ConfirmHostKey = (hostKey: UnknownHostKey) => Promise<boolean>;

const errorMessage = (error: unknown) => typeof error === 'string'
  ? error
  : (error instanceof Error ? error.message : String(error));

function parseUnknownHostKey(error: unknown): UnknownHostKey | null {
  const message = errorMessage(error);
  const marker = 'SSH_HOST_KEY_UNKNOWN|';
  const markerIndex = message.indexOf(marker);
  if (markerIndex < 0) return null;
  const [host, port, algorithm, fingerprint] = message.slice(markerIndex + marker.length).split('|');
  if (!host || !port || !algorithm || !fingerprint) return null;
  return { host, port: Number(port), algorithm, fingerprint };
}

export async function invokeWithHostTrust<T>(
  command: string,
  args: Record<string, unknown>,
  lang: 'zh' | 'en',
  confirmHostKey: ConfirmHostKey
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const unknownHost = parseUnknownHostKey(error);
    if (!unknownHost) throw error;

    const confirmed = await confirmHostKey(unknownHost);
    if (!confirmed) throw new Error(lang === 'zh' ? '已取消信任未知服务器' : 'Unknown server was not trusted');

    await invoke('trust_ssh_host_key', {
      host: unknownHost.host,
      port: unknownHost.port,
      expectedFingerprint: unknownHost.fingerprint
    });
    return invoke<T>(command, args);
  }
}
