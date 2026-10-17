import {
  liveProxyContext,
  liveProxyFailure,
  proxyLiveResponse,
} from '@/lib/live-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    return await proxyLiveResponse(
      request,
      await liveProxyContext(request),
      true
    );
  } catch (error) {
    return liveProxyFailure(error);
  }
}
