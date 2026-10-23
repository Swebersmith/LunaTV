import type { VodAdFilterResult } from './vod-segment-filter';
import { sourceToFilteredTime } from './vod-segment-filter';

interface PreparedSource { url: string; type: string; filter: VodAdFilterResult; expiresAt: number }
const cache = new Map<string, { created: number; promise: Promise<PreparedSource> }>();

export function preparePlayerSource(url: string, blockAds: boolean): Promise<PreparedSource> {
  const key = JSON.stringify([url,blockAds]);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.created < 30 * 60 * 1000) return existing.promise;
  const promise = (async () => {
    const response = await fetch('/api/player/prepare', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, blockAds }),
    });
    if (!response.ok) throw new Error('无法准备去广告播放清单');
    return await response.json() as PreparedSource;
  })();
  const entry = { created: Date.now(), promise };
  cache.set(key,entry);
  void promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  // Bound this per-tab cache while browsing episodes.
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return promise;
}

export async function prepareCastSource(source: { url: string; title?: string }, blockAds: boolean) {
  const prepared = await preparePlayerSource(source.url,blockAds);
  return { ...source, ...prepared, mapTime: (time: number) => sourceToFilteredTime(prepared.filter.removed,time) };
}
