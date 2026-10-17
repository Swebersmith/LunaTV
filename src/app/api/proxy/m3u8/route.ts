import {
  fetchLiveUpstream,
  liveProxyContext,
  LiveProxyError,
  liveProxyFailure,
  liveResponseHeaders,
  readLiveText,
  rewriteLivePlaylist,
} from '@/lib/live-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { url, source, ua } = await liveProxyContext(request);
    const response = await fetchLiveUpstream(url, ua, request);
    const headers = liveResponseHeaders(response);
    if (response.url && response.url !== url) {
      // Keep subsequent reloads on the resolved backend. Re-fetching a public
      // load-balancer URL can alternate between incompatible live timelines.
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
  } catch (error) {
    return liveProxyFailure(error);
  }
}
