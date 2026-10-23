/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createHmac, webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInThisContext } from 'vm';

import { adFixture } from './__fixtures__/vod-playlist';
import { handlePlayerMedia } from './player-media';

Object.assign(global, runInThisContext('({Response,Request,Headers,ReadableStream,TextEncoder,TextDecoder,btoa,atob})'));
Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
const secret = 'player-media-test-secret';
const env = { PASSWORD: secret, STORAGE_TYPE: 'cloudflare-d1' };
const cookie = 'auth=' + encodeURIComponent(JSON.stringify({ username:'viewer',signature:createHmac('sha256',secret).update('viewer').digest('hex') }));
const originalFetch = global.fetch;
let playlist = '';
const rootUrl = 'https://media.example/show/index.m3u8?token=a%2Fb';
beforeEach(() => {
  playlist = adFixture({ key: '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"' });
  global.fetch = jest.fn(async (input: string) => {
    const url = String(input);
    if (/\.m3u8(?:[?#]|$)/.test(url)) return new Response(playlist,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
    return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'video/mp2t','Content-Range':'bytes 0-2/9','Content-Length':'3'}});
  }) as jest.Mock;
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

const prepare = (body: unknown = {url:rootUrl}, auth = cookie) => handlePlayerMedia(new Request('https://tv.example/api/player/prepare',{
  method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:JSON.stringify(body),
}),env);
const get = (url: string, init?: RequestInit) => handlePlayerMedia(new Request(url,init),env);
const grantOf = (url: string) => JSON.parse(Buffer.from(new URL(url).searchParams.get('token')!.split('.')[0],'base64url').toString('utf8'));

it('issues cookie-free filtered playlists, signs every retained segment/key, and preserves original time metadata', async () => {
  const ready = await (await prepare())!.json();
  expect(ready.filter.reason).toBe('filtered');
  expect(ready.filter.removed).toHaveLength(1);
  expect(ready.url).not.toContain(secret);
  const response = (await get(ready.url))!;
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(Number(response.headers.get('X-Crayon-Ad-Seconds'))).toBeCloseTo(12.5);
  const content = await response.text();
  const urls = content.split('\n').filter(line => line.startsWith('https://'));
  expect(urls.length).toBe(48);
  const targets = urls.map(grantOf).map(item => item.u);
  expect(targets.some(url => url.includes('insert-'))).toBe(false);
  expect(targets[0]).toContain('/video/before-0.ts');
  expect(content).toMatch(/URI="https:\/\/tv.example\/api\/player\/media\?token=/);
  expect(content).toContain('IV=0x');
});
it('streams signed media/Range without forwarding website cookies or other client credentials', async () => {
  const ready = await (await prepare())!.json();
  const text = await (await get(ready.url))!.text();
  const segment = text.split('\n').find(line=>line.startsWith('https://'))!;
  const response = (await get(segment,{headers:{Range:'bytes=0-2',Cookie:'private-cookie',Authorization:'private'}}))!;
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 0-2/9');
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1,2,3]);
  const forwarded = (global.fetch as jest.Mock).mock.calls.slice(-1)[0][1].headers as Headers;
  expect(forwarded.get('Range')).toBe('bytes=0-2');
  expect(forwarded.get('Cookie')).toBeNull();
  expect(forwarded.get('Authorization')).toBeNull();
});
it('rejects unauthenticated issuance, tampered/expired links, private addresses and private redirects', async () => {
  expect((await prepare(undefined,''))!.status).toBe(401);
  for (const url of ['http://127.0.0.1/a.m3u8','http://169.254.169.254/a.m3u8','http://localhost/a.m3u8','file:///tmp/a']) {
    expect((await prepare({url}))!.status).toBe(502);
  }
  const ready = await (await prepare())!.json();
  const changed = new URL(ready.url);
  const token = changed.searchParams.get('token')!;
  changed.searchParams.set('token',token.slice(0,-1)+(token.endsWith('a')?'b':'a'));
  expect((await get(changed.href))!.status).toBe(401);
  const now = Date.now(); jest.spyOn(Date,'now').mockReturnValue(now + 9 * 60 * 60 * 1000);
  expect((await get(ready.url))!.status).toBe(401);
  jest.restoreAllMocks();
  (global.fetch as jest.Mock).mockResolvedValue(new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}}));
  expect((await prepare())!.status).toBe(502);
});
it('keeps ads when disabled and does not independently cut multi-track master renditions', async () => {
  const ready = await (await prepare({url:rootUrl,blockAds:false}))!.json();
  const text = await (await get(ready.url))!.text();
  expect(text.split('\n').filter(line=>line.startsWith('https://')).map(grantOf).some(item=>item.u.includes('insert-'))).toBe(true);
  playlist = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=10000,AUDIO="audio"\nvideo.m3u8\n';
  const multi = await (await prepare())!.json();
  const master = await (await get(multi.url))!.text();
  const variant = master.split('\n').find(line=>line.startsWith('https://'))!;
  expect(grantOf(variant).b).toBe(false);
});
it('filters the reported Bear episode by 26.04 seconds without changing programme order', async () => {
  playlist = readFileSync(join(__dirname,'__fixtures__/baofeng/bear-episode1.m3u8'),'utf8');
  const ready = await (await prepare())!.json();
  expect(ready.filter.removed).toHaveLength(1);
  expect(ready.filter.removed[0].end-ready.filter.removed[0].start).toBeCloseTo(26.04);
  const expected = playlist.split('\n').filter(line=>line.trim()&&!line.startsWith('#')&&!line.includes('/adjump/')).map(line=>new URL(line,rootUrl).href);
  const actual = (await (await get(ready.url))!.text()).split('\n').filter(line=>line.startsWith('https://')).map(grantOf).map(item=>item.u);
  expect(actual).toEqual(expected);
});
