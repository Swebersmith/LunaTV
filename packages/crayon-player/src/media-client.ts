import type { VodAdFilterResult } from './vod-segment-filter';

export interface PreparedMedia {
  url: string;
  type?: string;
  filter: VodAdFilterResult;
  expiresAt?: number;
}
export type MediaPreparer = (url: string, blockAds: boolean) => Promise<PreparedMedia>;

/** One bounded cache is shared by local playback and casting for this adapter. */
export function createMediaPreparer(endpoint = '/api/player/prepare'): MediaPreparer {
  const cache = new Map<string, { created: number; expiresAt: number; promise: Promise<PreparedMedia> }>();
  return (url, blockAds) => {
    const key = JSON.stringify([url, blockAds]);
    const now = Date.now();
    const existing = cache.get(key);
    if (existing && now - existing.created < 30 * 60 * 1000 && existing.expiresAt > now + 60000) return existing.promise;
    let expiresAt = Infinity;
    const promise: Promise<PreparedMedia> = (async () => {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, blockAds }),
      });
      if (!response.ok) throw new Error('无法准备去广告播放清单，请确认登录和服务配置');
      const result = await response.json() as PreparedMedia;
      if (typeof result.url !== 'string' || !result.url.trim() || !result.filter ||
        !Number.isFinite(result.filter.originalDuration) || result.filter.originalDuration < 0 ||
        !['filtered', 'no-match', 'unsupported'].includes(result.filter.reason) || !Array.isArray(result.filter.removed) ||
        !result.filter.removed.every((range, index, ranges) => range && Number.isFinite(range.start) && Number.isFinite(range.end) &&
          range.start >= 0 && range.end > range.start && range.end <= result.filter.originalDuration && (!index || ranges[index - 1].end <= range.start))) {
        throw new Error('播放服务返回了无效清单');
      }
      const target = new URL(result.url, document.baseURI);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error('播放服务返回了无效清单');
      expiresAt = result.expiresAt ?? now + 30 * 60 * 1000;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000) throw new Error('播放清单已过期，请重试');
      return { ...result, url: target.href };
    })();
    const entry = { created: now, get expiresAt() { return expiresAt; }, promise };
    cache.set(key, entry);
    void entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
    return entry.promise;
  };
}
