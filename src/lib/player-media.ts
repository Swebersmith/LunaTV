import { readLiveText } from './live-proxy-core';
import { filterVodAdSegments, VodAdFilterResult } from './vod-segment-filter';

interface Environment { PASSWORD?: string; STORAGE_TYPE?: string }
interface Grant { u: string; e: number; b: boolean; m: 'p' | 'r' }
const encoder = new TextEncoder();
const lifetime = 8 * 60 * 60;
const headers = () => new Headers({
  'Cache-Control': 'private, no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Crayon-Ad-Seconds',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
});
const plainFilter = (): VodAdFilterResult => ({ playlist: '', originalDuration: 0, removed: [], reason: 'unsupported' });
const externalTracks = (text: string) => text.split(/\r?\n/).some(line =>
  line.startsWith('#EXT-X-MEDIA:') && /TYPE=(?:AUDIO|SUBTITLES)(?:,|$)/.test(line) && /URI=/.test(line)
);

function publicUrl(value: string, base?: string) {
  const url = new URL(value, base);
  const host = url.hostname.toLowerCase();
  if (value.length > 8192 || !/^https?:$/.test(url.protocol) || url.username || url.password ||
    !host.includes('.') && !host.startsWith('[') || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid)$/.test(host)) throw new Error('Invalid media address');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a,b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) throw new Error('Private media address');
  }
  if (host.startsWith('[') && (!/^\[(?:2|3)[0-9a-f]{3}:/i.test(host) || /^\[2001:db8:/i.test(host))) throw new Error('Private media address');
  return url;
}
const keyFor = (secret: string) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
function encode(value: string) {
  return btoa(Array.from(encoder.encode(value),byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)));
}
async function sign(grant: Grant, key: CryptoKey) {
  const payload = encode(JSON.stringify(grant));
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('crayon-media-v1:' + payload)));
  return payload + '.' + Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
}
async function verify(token: string, key: CryptoKey): Promise<Grant> {
  if (token.length > 24000) throw new Error('Invalid media token');
  const [payload, signature, extra] = token.split('.');
  if (!payload || extra || !/^[0-9a-f]{64}$/.test(signature || '')) throw new Error('Invalid media token');
  const bytes = Uint8Array.from(signature.match(/../g) || [], hex => parseInt(hex,16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode('crayon-media-v1:' + payload))) throw new Error('Invalid media token');
  const grant = JSON.parse(decode(payload));
  const now = Math.floor(Date.now()/1000);
  if (!Number.isInteger(grant.e) || grant.e <= now || grant.e > now + lifetime + 60 || typeof grant.u !== 'string' ||
    typeof grant.b !== 'boolean' || !['p','r'].includes(grant.m)) throw new Error('Expired media token');
  publicUrl(grant.u);
  return grant;
}

async function loggedIn(request: Request, env: Environment, key: CryptoKey) {
  try {
    const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];
    if (!cookie || cookie.length > 8192) return false;
    let value = decodeURIComponent(cookie);
    if (!value.trimStart().startsWith('{')) value = decodeURIComponent(value);
    const auth = JSON.parse(value);
    if (env.STORAGE_TYPE === 'localstorage') {
      if (typeof auth.password !== 'string' || !auth.password) return false;
      const candidate = await keyFor(auth.password);
      const message = encoder.encode('crayon-player-local-auth');
      return crypto.subtle.verify('HMAC',candidate,await crypto.subtle.sign('HMAC',key,message),message);
    }
    if (!auth.username || typeof auth.username !== 'string' || !/^[0-9a-f]{64}$/i.test(auth.signature || '')) return false;
    const signature = Uint8Array.from((auth.signature as string).match(/../g) || [], hex => parseInt(hex,16));
    return crypto.subtle.verify('HMAC', key, signature, encoder.encode(auth.username));
  } catch { return false; }
}

async function upstream(value: string, request: Request, resource = false) {
  let target = publicUrl(value);
  for (let count=0;count<6;count++) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, 20000);
    const requestHeaders = new Headers({ 'User-Agent': 'CrayonPlayer/0.2', 'Accept-Encoding': 'identity' });
    if (resource) for (const name of ['range','if-range']) {
      const value = request.headers.get(name); if (value) requestHeaders.set(name,value);
    }
    let response: Response;
    try { response = await fetch(target.href, { headers: requestHeaders, signal: controller.signal, redirect: 'manual', cache: 'no-store' }); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort',abort); }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Invalid redirect');
      target = publicUrl(location,target.href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Media upstream unavailable'); }
    return { response, url: target.href };
  }
  throw new Error('Too many media redirects');
}

async function mediaUrl(origin: string, grant: Grant, key: CryptoKey) {
  const url = new URL('/api/player/media',origin);
  url.searchParams.set('token',await sign(grant,key));
  return url.href;
}

async function rewrite(content: string, base: string, origin: string, grant: Grant, key: CryptoKey) {
  let variant = false;
  const cached = new Map<string,Promise<string>>();
  const proxy = (value: string, mode: Grant['m'], keyUri = false) => {
    if (keyUri && /^(?:data|skd|urn):/i.test(value)) return Promise.resolve(value);
    const url = publicUrl(value,base).href;
    const id = mode + url;
    const existing = cached.get(id);
    if (existing) return existing;
    const result = mediaUrl(origin,{...grant,u:url,m:mode},key);
    cached.set(id,result);
    return result;
  };
  return (await Promise.all(content.split(/\r?\n/).map(async raw => {
    const line = raw.trim();
    if (!line) return '';
    if (!line.startsWith('#')) {
      const kind = variant || /\.m3u8(?:[?#]|$)/i.test(line) ? 'p' : 'r';
      variant = false;
      return proxy(line,kind);
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
    const kind = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line) ? 'p' : 'r';
    const matches = Array.from(line.matchAll(/\bURI="([^"]+)"/g));
    const values = await Promise.all(matches.map(match => proxy(match[1],kind,/^#EXT-X-(?:SESSION-)?KEY:/.test(line))));
    let index = 0;
    return line.replace(/\bURI="([^"]+)"/g, () => `URI="${values[index++]}"`);
  }))).join('\n');
}

/** Narrow, signed, expiring media URLs allow native playback/TVs without website cookies. */
export async function handlePlayerMedia(request: Request, env: Environment): Promise<Response | null> {
  const incoming = new URL(request.url);
  if (!['/api/player/prepare','/api/player/media'].includes(incoming.pathname)) return null;
  const h = headers();
  if (!env.PASSWORD) return new Response('Player relay is unavailable',{status:503,headers:h});
  const authKey = await keyFor(env.PASSWORD);
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.sign('HMAC',authKey,encoder.encode('crayon-player-media-key-v1')), { name:'HMAC',hash:'SHA-256' }, false, ['sign','verify']);
  if (incoming.pathname.endsWith('/prepare')) {
    if (request.method !== 'POST') return new Response(null,{status:405,headers:h});
    const origin = request.headers.get('origin');
    if (origin && origin !== incoming.origin || !await loggedIn(request,env,authKey)) return new Response('Unauthorized',{status:401,headers:h});
    try {
      const body = await readLiveText(new Response(request.body),12000,10000);
      const input = JSON.parse(body);
      let url = publicUrl(input.url).href;
      const isHls = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(input.type || '');
      let block = input.blockAds !== false;
      let filter = plainFilter();
      if (isHls) {
        let resolved = false;
        for (let depth=0;depth<5;depth++) {
          const current = await upstream(url,request);
          url = current.url;
          const text = await readLiveText(current.response);
          if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
          // External audio/subtitle renditions must retain a coordinated timeline.
          if (externalTracks(text)) { block = false; resolved = true; break; }
          if (text.includes('#EXT-X-STREAM-INF:')) {
            const child = text.split(/\r?\n/).map(line=>line.trim()).find(line=>line && !line.startsWith('#'));
            if (!child) throw new Error('Empty HLS master');
            url = publicUrl(child,url).href;
          } else { filter = block ? filterVodAdSegments(text,url) : plainFilter(); resolved = true; break; }
        }
        if (!resolved) throw new Error('Nested HLS limit');
      }
      const expiry = Math.floor(Date.now()/1000)+lifetime;
      const result = {
        url: await mediaUrl(incoming.origin,{u:url,e:expiry,b:block,m:isHls?'p':'r'},key),
        type: isHls ? 'application/x-mpegURL' : input.type || 'video/mp4',
        filter: {...filter,playlist:''}, expiresAt: expiry * 1000,
      };
      h.set('Content-Type','application/json');
      return new Response(JSON.stringify(result),{headers:h});
    } catch { return new Response('无法准备播放清单，请检查片源后重试',{status:502,headers:h}); }
  }
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:h});
  if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:h});
  let grant: Grant;
  try { grant = await verify(incoming.searchParams.get('token') || '',key); }
  catch { return new Response('Invalid or expired media link',{status:401,headers:h}); }
  try {
    const current = await upstream(grant.u,request,grant.m==='r');
    if (grant.m === 'r') {
      for (const name of ['content-type','content-length','content-range','accept-ranges']) {
        const value = current.response.headers.get(name); if (value) h.set(name,value);
      }
      if (request.method === 'HEAD') { await current.response.body?.cancel(); return new Response(null,{status:current.response.status,headers:h}); }
      return new Response(current.response.body,{status:current.response.status,headers:h});
    }
    const content = await readLiveText(current.response);
    if (!content.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
    const external = externalTracks(content);
    if (external) grant = {...grant,b:false};
    const result = grant.b ? filterVodAdSegments(content,current.url) : {...plainFilter(),playlist:content};
    const playlist = await rewrite(result.playlist,current.url,incoming.origin,grant,key);
    h.set('Content-Type','application/vnd.apple.mpegurl');
    h.set('X-Crayon-Ad-Seconds',String(result.removed.reduce((sum,range)=>sum+range.end-range.start,0)));
    return new Response(request.method==='HEAD'?null:playlist,{headers:h});
  } catch { return new Response('Media relay unavailable',{status:502,headers:h}); }
}
