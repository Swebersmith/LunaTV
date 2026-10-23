/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInThisContext } from 'vm';
const { Miniflare } = require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const esbuild = require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
jest.setTimeout(30000);
const NativeResponse = runInThisContext('Response');

it('serves filtered playlists and signed segment bytes in real workerd without cookies on TV requests',async()=>{
  const built = esbuild.buildSync({entryPoints:['src/lib/player-media.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
  const secret = 'workerd-player-only';
  const fixture = readFileSync(join(__dirname,'__fixtures__/baofeng/bear-episode1.m3u8'),'utf8');
  const runtime = new Miniflare({
    compatibilityDate:'2025-04-01',modules:true,
    script:built.outputFiles[0].text+'\nexport default { fetch(request,env) { return handlePlayerMedia(request,env); } };',
    bindings:{PASSWORD:secret,STORAGE_TYPE:'cloudflare-d1'},
    outboundService:(request:Request)=>new URL(request.url).pathname.endsWith('.m3u8')
      ? new NativeResponse(fixture,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}})
      : new NativeResponse(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'video/mp2t','Content-Range':'bytes 0-2/9','Content-Length':'3'}}),
  });
  try {
    const cookie = 'auth='+encodeURIComponent(JSON.stringify({username:'viewer',signature:createHmac('sha256',secret).update('viewer').digest('hex')}));
    const response = await runtime.dispatchFetch('https://tv.example/api/player/prepare',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({url:'https://media.example/episode.m3u8',blockAds:true})});
    expect(response.status).toBe(200);
    const prepared = await response.json();
    expect(prepared.filter.removed[0].end-prepared.filter.removed[0].start).toBeCloseTo(26.04);
    const media = await runtime.dispatchFetch(prepared.url);
    expect(media.status).toBe(200);
    expect(Number(media.headers.get('X-Crayon-Ad-Seconds'))).toBeCloseTo(26.04);
    const playlist = await media.text();
    const segment = playlist.split('\n').find((line:string)=>line.startsWith('https://')) || '';
    const bytes = await runtime.dispatchFetch(segment,{headers:{Range:'bytes=0-2'}});
    expect(bytes.status).toBe(206);
    expect(Array.from(new Uint8Array(await bytes.arrayBuffer()))).toEqual([1,2,3]);
    const invalid = await runtime.dispatchFetch('https://tv.example/api/player/media?token=wrong');
    expect(invalid.status).toBe(401);
  } finally { await runtime.dispose(); }
});
