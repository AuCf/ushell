import { ServerProfile } from '../types';

/**
 * FinalShell JSON & Config Parser
 * Supports parsing FinalShell conn.json exported server configuration files
 * or raw text server lists.
 */
export function parseFinalShellConfig(rawContent: string): ServerProfile[] {
  const importedProfiles: ServerProfile[] = [];

  try {
    // Attempt 1: Standard JSON Array or Object
    const parsed = JSON.parse(rawContent);
    const items = Array.isArray(parsed) ? parsed : (parsed.conns || [parsed]);

    for (const item of items) {
      if (item.host || item.ip) {
        importedProfiles.push({
          id: `fs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: item.name || item.remark || item.host || '外部导入服务器',
          host: item.host || item.ip || '127.0.0.1',
          port: Number(item.port) || 22,
          username: item.user || item.username || 'root',
          authType: item.password ? 'password' : 'privateKey',
          password: item.password || '',
          group: item.group || '外部导入',
          tags: ['外部配置', '导入'],
          createdAt: Date.now()
        });
      }
    }
  } catch (e) {
    // Attempt 2: Text Line-by-Line Parsing (e.g., user pasted lines like root@192.168.1.1:22)
    const lines = rawContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match patterns like: name,host,port,user or user@host:port
      const userHostMatch = trimmed.match(/^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/);
      if (userHostMatch) {
        const username = userHostMatch[1] || 'root';
        const host = userHostMatch[2];
        const port = parseInt(userHostMatch[3] || '22', 10);

        importedProfiles.push({
          id: `fs_txt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: `导入 - ${host}`,
          host,
          port,
          username,
          authType: 'password',
          group: '文本导入',
          tags: ['批量导入'],
          createdAt: Date.now()
        });
      }
    }
  }

  return importedProfiles;
}
