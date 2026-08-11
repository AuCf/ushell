export interface ReleaseInfo {
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  downloadUrl?: string;
}

export const CURRENT_VERSION = '0.0.4';

export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.replace(/^v/, '').trim();
  const l = latest.replace(/^v/, '').trim();
  const cParts = c.split('.').map(n => parseInt(n, 10) || 0);
  const lParts = l.split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const curr = cParts[i] || 0;
    const lat = lParts[i] || 0;
    if (lat > curr) return true;
    if (lat < curr) return false;
  }
  return false;
}

export async function checkGitHubUpdate(): Promise<{ hasUpdate: boolean; release?: ReleaseInfo }> {
  try {
    const res = await fetch('https://api.github.com/repos/AuCf/ushell/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) {
      return { hasUpdate: false };
    }

    const data = await res.json();
    const tagName = data.tag_name || data.name || '';
    const cleanTag = tagName.replace(/^v/, '');

    const hasUpdate = isNewerVersion(CURRENT_VERSION, cleanTag);

    const windowsAsset = data.assets?.find((a: any) => a.name.endsWith('.exe') || a.name.endsWith('.msi'));
    const downloadUrl = windowsAsset?.browser_download_url || data.html_url;

    return {
      hasUpdate,
      release: {
        version: cleanTag,
        name: data.name || `v${cleanTag}`,
        body: data.body || '特性更新与性能优化。',
        publishedAt: data.published_at ? new Date(data.published_at).toLocaleDateString() : '',
        htmlUrl: data.html_url,
        downloadUrl
      }
    };
  } catch (e) {
    return { hasUpdate: false };
  }
}
