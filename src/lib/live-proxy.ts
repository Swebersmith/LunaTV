import { getConfig } from '@/lib/config';

import { LiveProxyError } from './live-proxy-core';
export * from './live-proxy-core';

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
