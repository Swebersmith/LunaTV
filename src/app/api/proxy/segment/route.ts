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
    const response = await fetchLiveUpstream(url, ua, request);
    // Native streaming preserves backpressure and propagates cancellation.
    return new Response(response.body, {
      status: response.status,
      headers: liveResponseHeaders(response),
    });
  } catch (error) {
    return liveProxyFailure(error);
  }
}
