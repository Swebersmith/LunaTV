import type { AdminConfigResult } from './admin.types';
import { getAuthInfoFromBrowserCookie } from './auth';

const PREFETCH_TTL = 15000;
let prefetched: {
  session: string;
  startedAt: number;
  request: Promise<AdminConfigResult>;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function currentSession() {
  return document.cookie.split(';').map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('auth=')) || '';
}

export function clearAdminConfigPrefetch() {
  if (prefetched) clearTimeout(prefetched.timer);
  prefetched = null;
}

async function requestConfig(): Promise<AdminConfigResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/admin/config', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || (response.status === 401 ? '登录已失效，请重新登录' : '获取管理配置失败，请重试'));
    if (!data?.Config || !['owner', 'admin'].includes(data.Role)) throw new Error('管理配置响应无效，请重试');
    return data as AdminConfigResult;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('管理面板加载超时，请重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Warm only after administrator intent. Keep this private data in memory for one
// navigation; refreshes after edits always request the current server config.
export function prefetchAdminConfig() {
  const role = getAuthInfoFromBrowserCookie()?.role;
  if (role !== 'owner' && role !== 'admin') return;
  const session = currentSession();
  if (prefetched?.session === session && Date.now() - prefetched.startedAt < PREFETCH_TTL) return;
  clearAdminConfigPrefetch();
  const request = requestConfig();
  prefetched = {
    session,
    startedAt: Date.now(),
    request,
    timer: setTimeout(clearAdminConfigPrefetch, PREFETCH_TTL),
  };
  return request.catch(() => {
    if (prefetched?.request === request) clearAdminConfigPrefetch();
  });
}

export function loadAdminConfig(usePrefetch = false): Promise<AdminConfigResult> {
  const entry = prefetched;
  clearAdminConfigPrefetch();
  if (usePrefetch && entry?.session === currentSession() && Date.now() - entry.startedAt < PREFETCH_TTL) {
    return entry.request;
  }
  return requestConfig();
}
