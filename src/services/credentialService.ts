import { invoke } from '@tauri-apps/api/core';
import { ServerProfile } from '../types';

export type PersistedServerProfile = Omit<ServerProfile, 'password' | 'privateKey'>;

export const stripServerSecrets = (server: ServerProfile): PersistedServerProfile => {
  const { password: _password, privateKey: _privateKey, ...profile } = server;
  return profile;
};

export async function saveServerCredential(server: ServerProfile): Promise<void> {
  const secret = server.authType === 'password' ? (server.password || '') : (server.privateKey || '');
  await invoke('save_server_secret', { serverId: server.id, secret });
}

export async function loadServerCredential(server: ServerProfile): Promise<ServerProfile> {
  const legacySecret = server.authType === 'password' ? server.password : server.privateKey;
  if (legacySecret) {
    await saveServerCredential(server);
    const storedSecret = await invoke<string | null>('load_server_secret', { serverId: server.id });
    if (storedSecret !== legacySecret) {
      throw new Error(`Credential verification failed for server ${server.name || server.id}`);
    }
  }
  const secret = legacySecret || await invoke<string | null>('load_server_secret', { serverId: server.id }) || '';
  return server.authType === 'password'
    ? { ...stripServerSecrets(server), password: secret }
    : { ...stripServerSecrets(server), privateKey: secret };
}

export async function deleteServerCredential(serverId: string): Promise<void> {
  await invoke('delete_server_secret', { serverId });
}

export async function hydrateServerProfiles(servers: ServerProfile[]): Promise<ServerProfile[]> {
  return Promise.all(servers.map(loadServerCredential));
}
