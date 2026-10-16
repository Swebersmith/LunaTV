import { getConfig } from '@/lib/config';

export class LiveProxyError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export async function liveProxyContext(request: Request) {
  const params = new URL(request.url).searchParams;
  // URLSearchParams has already decoded this value. Decoding twice corrupts signatures.
  const url = params.get('url');
  const source = params.get('moontv-source') || params.get('source');
  if (!url || !/^https?:\/\//i.test(url))
    throw new LiveProxyError('直播地址必须使用 HTTP 或 HTTPS', 400);
  const config = await getConfig();
  const live = config.LiveConfig?.find(
    (item) => item.key === source && !item.disabled
  );
  if (!live) throw new LiveProxyError('直播源不存在或已禁用', 404);
  const target = new URL(url);
  for (const name of ['_HLS_msn', '_HLS_part', '_HLS_skip']) {
    const value = params.get(name);
    if (value !== null) target.searchParams.set(name, value);
  }
  return {
    url: target.href,
    source: live.key,
    ua: live.ua || 'AptvPlayer/1.4.10',
  };
}

export async function fetchLiveUpstream(
  url: string,
  ua: string,
  request?: Request,
  timeout = 15000
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request?.signal.addEventListener('abort', abort, { once: true });
  if (request?.signal.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const headers = new Headers({ 'User-Agent': ua });
  for (const name of ['range', 'if-range']) {
    const value = request?.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LiveProxyError(
        `直播源返回 ${response.status}`,
        response.status === 404 ? 404 : 502
      );
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted)
      throw new LiveProxyError('直播源连接超时，请重试或切换频道', 504);
    throw error;
  } finally {
    // Only limit connection establishment. A healthy video stream can live for hours.
    clearTimeout(timer);
    request?.signal.removeEventListener('abort', abort);
  }
}

export function liveResponseHeaders(response?: Response) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges',
  });
  for (const name of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
  ]) {
    const value = response?.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function liveProxyFailure(error: unknown) {
  const headers = liveResponseHeaders();
  headers.set('Content-Type', 'application/json');
  return new Response(
    JSON.stringify({
      error:
        error instanceof LiveProxyError
          ? error.message
          : '直播源暂时无法连接，请重试或切换频道',
    }),
    { status: error instanceof LiveProxyError ? error.status : 502, headers }
  );
}

// Buffer only bounded text playlists, never video segments or continuous streams.
export async function readLiveText(
  response: Response,
  limit = 4 * 1024 * 1024,
  timeout = 15000
) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => undefined);
  }, timeout);
  try {
    let doneReading = false;
    while (!doneReading) {
      const { done, value } = await reader.read();
      if (expired) throw new LiveProxyError('直播列表读取超时', 504);
      if (done) {
        doneReading = true;
        break;
      }
      length += value.byteLength;
      if (length > limit) throw new LiveProxyError('直播列表过大');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function rewriteLivePlaylist(
  content: string,
  playlistUrl: string,
  origin: string,
  source: string,
  direct = false
) {
  const proxy = (value: string, kind: 'm3u8' | 'segment' | 'key') => {
    const resolved = new URL(value, playlistUrl);
    if (!/^https?:$/.test(resolved.protocol)) return value;
    if (direct && kind === 'segment' && resolved.protocol === 'https:')
      return resolved.href;
    const target = new URL(`/api/proxy/${kind}`, origin);
    target.searchParams.set('url', resolved.href);
    target.searchParams.set('moontv-source', source);
    if (direct && kind === 'm3u8') target.searchParams.set('allowCORS', 'true');
    return target.href;
  };
  let variant = false;
  return content
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return line;
      if (!line.startsWith('#')) {
        const kind =
          variant || /\.m3u8(?:[?#]|$)/i.test(line) ? 'm3u8' : 'segment';
        variant = false;
        return proxy(line, kind);
      }
      if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
      const kind = /^#EXT-X-(?:SESSION-)?KEY:/.test(line)
        ? 'key'
        : /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line)
        ? 'm3u8'
        : 'segment';
      return line.replace(
        /\bURI="([^"]+)"/g,
        (_match, uri: string) => `URI="${proxy(uri, kind)}"`
      );
    })
    .join('\n');
}
