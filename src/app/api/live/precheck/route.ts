import {
  fetchLiveUpstream,
  liveProxyContext,
  liveProxyFailure,
  liveResponseHeaders,
} from '@/lib/live-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { url, ua } = await liveProxyContext(request);
    const response = await fetchLiveUpstream(url, ua, request, 6000);
    const contentType = response.headers.get('content-type') || '';
    await response.body?.cancel();
    const type = /video\/mp4/i.test(contentType)
      ? 'mp4'
      : /(?:x-flv|video\/flv)/i.test(contentType)
      ? 'flv'
      : 'm3u8';
    const headers = liveResponseHeaders();
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ success: true, type }), { headers });
  } catch (error) {
    return liveProxyFailure(error);
  }
}
