import type { VodAdFilterResult } from './vod-segment-filter';

export interface PreparedMedia {
  url: string;
  type?: string;
  filter: VodAdFilterResult;
  expiresAt?: number;
}
export type MediaPreparer = (url: string, blockAds: boolean) => Promise<PreparedMedia>;

/** Safe messages only: never show an upstream URL, response body or credentials. */
export class MediaPreparationError extends Error {
  constructor(message: string, readonly browserFallback: boolean, readonly code: string) {
    super(message);
    this.name = 'MediaPreparationError';
  }
}

export function mediaPreparationNotice(error: unknown, browserFallback = false): string {
  if (browserFallback) return '服务端去广告暂不可用，已切换浏览器过滤；投屏仍需服务恢复';
  return error instanceof MediaPreparationError ? error.message : '去广告清单准备失败，请稍后重试或更换片源';
}

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
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, blockAds }),
        });
      } catch {
        throw new MediaPreparationError('无法连接去广告服务，请检查网络后重试', true, 'SERVICE_UNREACHABLE');
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new MediaPreparationError('登录已失效或无权准备清单，请重新登录', false, 'UNAUTHORIZED');
        if (response.status === 503) throw new MediaPreparationError('去广告服务未就绪，请检查服务配置或稍后重试', true, 'SERVICE_UNAVAILABLE');
        let code: string | undefined;
        let upstreamStatus: number | undefined;
        try {
          const body = await response.json();
          code = body?.error?.code;
          const status = body?.error?.upstreamStatus;
          if (Number.isInteger(status) && status >= 400 && status <= 599) upstreamStatus = status;
        } catch { /* Older servers may return plain text. */ }
        const messages: Record<string, string> = {
          UPSTREAM_TIMEOUT: '片源清单读取超时，请稍后重试或更换片源',
          UPSTREAM_UNAVAILABLE: `去广告服务无法读取片源清单${upstreamStatus ? `（HTTP ${upstreamStatus}）` : ''}，请重试或更换片源`,
          INVALID_PLAYLIST: '片源返回的内容不是有效播放清单，请更换片源',
          INVALID_REQUEST: '播放地址或请求无效，请重新选集或更换片源',
        };
        throw new MediaPreparationError(messages[code || ''] || '去广告服务暂时不可用，请稍后重试；若提示持续出现，请检查登录和服务配置', response.status >= 500 && code !== 'INVALID_REQUEST', code || 'SERVICE_ERROR');
      }
      let result: PreparedMedia;
      try { result = await response.json() as PreparedMedia; }
      catch { throw new MediaPreparationError('播放服务返回了无效清单',false,'INVALID_RESPONSE'); }
      if (!result || typeof result.url !== 'string' || !result.url.trim() || !result.filter ||
        !Number.isFinite(result.filter.originalDuration) || result.filter.originalDuration < 0 ||
        !['filtered', 'no-match', 'unsupported'].includes(result.filter.reason) || !Array.isArray(result.filter.removed) ||
        !result.filter.removed.every((range, index, ranges) => range && Number.isFinite(range.start) && Number.isFinite(range.end) &&
          range.start >= 0 && range.end > range.start && range.end <= result.filter.originalDuration && (!index || ranges[index - 1].end <= range.start))) {
        throw new MediaPreparationError('播放服务返回了无效清单',false,'INVALID_RESPONSE');
      }
      let target: URL;
      try { target = new URL(result.url, document.baseURI); }
      catch { throw new MediaPreparationError('播放服务返回了无效清单',false,'INVALID_RESPONSE'); }
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new MediaPreparationError('播放服务返回了无效清单',false,'INVALID_RESPONSE');
      expiresAt = result.expiresAt ?? now + 30 * 60 * 1000;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000) throw new MediaPreparationError('播放清单已过期，请重试',false,'EXPIRED_RESPONSE');
      return { ...result, url: target.href };
    })();
    const entry = { created: now, get expiresAt() { return expiresAt; }, promise };
    cache.set(key, entry);
    void entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
    return entry.promise;
  };
}
