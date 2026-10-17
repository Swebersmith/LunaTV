import { liveFetch } from './live-http';

export class LiveProxyError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
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
    const response = await liveFetch(url, headers, controller.signal);
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

export async function proxyLiveResponse(
  request: Request,
  context: { url: string; source: string; ua: string },
  playlist: boolean
) {
  const { url, source, ua } = context;
  const response = await fetchLiveUpstream(url, ua, request);
  const headers = liveResponseHeaders(response);
  if (!playlist)
    return new Response(response.body, { status: response.status, headers });
  if (response.url && response.url !== url) {
    await response.body?.cancel();
    const target = new URL(request.url);
    target.searchParams.set('url', response.url);
    headers.set('Location', target.href);
    headers.delete('content-length');
    headers.delete('content-range');
    return new Response(null, { status: 307, headers });
  }
  const type = headers.get('content-type') || '';
  if (/^(video|audio)\//i.test(type) && !/mpegurl/i.test(type))
    return new Response(response.body, { status: response.status, headers });
  const content = await readLiveText(response);
  if (!content.trimStart().startsWith('#EXTM3U'))
    throw new LiveProxyError('该地址未返回有效的 HLS 播放列表');
  const rewritten = rewriteLivePlaylist(
    content,
    response.url || url,
    new URL(request.url).origin,
    source,
    new URL(request.url).searchParams.get('allowCORS') === 'true'
  );
  headers.set('Content-Type', 'application/vnd.apple.mpegurl');
  headers.delete('content-length');
  return new Response(rewritten, { headers });
}
