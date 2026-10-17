import type { CloudflareD1Binding } from './cloudflare-d1.db';
import {
  LiveProxyError,
  liveProxyFailure,
  proxyLiveResponse,
} from './live-proxy-core';

interface Environment {
  STORAGE_TYPE?: string;
  PASSWORD?: string;
  LUNATV_D1?: CloudflareD1Binding;
}

async function authenticated(request: Request, secret: string) {
  const cookie = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];
  if (!cookie || cookie.length > 8192) return false;
  try {
    let decoded = decodeURIComponent(cookie);
    // The login route encodes JSON, then Next.js encodes the cookie value.
    // Unwrap that second layer only before reaching JSON, so literal percent
    // sequences in a username remain part of the signed username.
    if (!decoded.trimStart().startsWith('{'))
      decoded = decodeURIComponent(decoded);
    const auth = JSON.parse(decoded);
    if (
      typeof auth.username !== 'string' ||
      !auth.username ||
      typeof auth.signature !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(auth.signature)
    )
      return false;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = new Uint8Array(32);
    for (let index = 0; index < signature.length; index++)
      signature[index] = parseInt(
        auth.signature.slice(index * 2, index * 2 + 2),
        16
      );
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(auth.username)
    );
  } catch {
    return false;
  }
}

// The media data plane uses Web APIs directly, without Next.js routing,
// middleware, full admin-config parsing or Node/Web stream adapters.
export async function handleLiveProxy(request: Request, env: Environment) {
  const incoming = new URL(request.url);
  if (
    !/^\/api\/proxy\/(?:m3u8|segment|key|logo)$/.test(incoming.pathname) ||
    env.STORAGE_TYPE !== 'cloudflare-d1' ||
    !env.LUNATV_D1
  )
    return null;
  if (!env.PASSWORD || !(await authenticated(request, env.PASSWORD)))
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  try {
    const params = incoming.searchParams;
    const url = params.get('url');
    const source = params.get('moontv-source') || params.get('source');
    if (!url || !/^https?:\/\//i.test(url))
      throw new LiveProxyError('直播地址必须使用 HTTP 或 HTTPS', 400);
    if (!source) throw new LiveProxyError('直播源不存在或已禁用', 404);
    // Read only the selected source's UA. Avoid transferring and normalizing
    // users, VOD sources and the rest of the admin configuration per segment.
    // A fresh query also makes disabling a source effective immediately.
    const row = await env.LUNATV_D1.prepare(
      `SELECT json_extract(source.value, '$.ua') AS ua
       FROM settings, json_each(settings.value, '$.LiveConfig') AS source
       WHERE settings.key = 'admin:config'
         AND json_extract(source.value, '$.key') = ?1
         AND COALESCE(json_extract(source.value, '$.disabled'), 0) = 0 LIMIT 1`
    )
      .bind(source)
      .first<{ ua: string | null }>();
    if (!row) throw new LiveProxyError('直播源不存在或已禁用', 404);
    const target = new URL(url);
    for (const name of ['_HLS_msn', '_HLS_part', '_HLS_skip']) {
      const value = params.get(name);
      if (value !== null) target.searchParams.set(name, value);
    }
    const response = await proxyLiveResponse(
      request,
      {
        url: target.href,
        source,
        ua: row.ua || 'AptvPlayer/1.4.10',
      },
      incoming.pathname.endsWith('/m3u8')
    );
    if (request.method === 'HEAD') {
      await response.body?.cancel();
      return new Response(null, response);
    }
    return response;
  } catch (error) {
    return liveProxyFailure(error);
  }
}
