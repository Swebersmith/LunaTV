/** @jest-environment node */
import { createHmac, webcrypto } from 'crypto';
import { runInThisContext } from 'vm';

import type { D1Statement } from './cloudflare-d1.db';
import { handleLiveProxy } from './live-worker';

Object.assign(
  global,
  runInThisContext(
    '({Response,Request,Headers,ReadableStream,TextEncoder,TextDecoder})'
  )
);
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const secret = 'worker-test-only';
const originalFetch = global.fetch;
const cookie =
  'auth=' +
  encodeURIComponent(
    JSON.stringify({
      username: '测试用户',
      signature: createHmac('sha256', secret).update('测试用户').digest('hex'),
    })
  );
const first = jest.fn();
const bind = jest.fn();
const statement: D1Statement = {
  bind(...args) {
    bind(...args);
    return statement;
  },
  first,
  all: jest.fn(),
  run: jest.fn(),
};
const prepare = jest.fn((_query: string) => statement);
const env = {
  STORAGE_TYPE: 'cloudflare-d1',
  PASSWORD: secret,
  LUNATV_D1: { prepare, batch: jest.fn() },
};
function request(path = 'segment', auth = cookie, method = 'GET') {
  return new Request(
    'https://tv.test/api/proxy/' +
      path +
      '?' +
      new URLSearchParams({
        url: 'https://media.test/live?token=a%2Fb',
        'moontv-source': 'tv',
      }),
    { method, headers: { Cookie: auth, Range: 'bytes=0-2' } }
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  first.mockResolvedValue({ ua: 'ConfiguredPlayer' });
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-2/9', 'Content-Length': '3' },
      })
    );
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('streams authenticated media using only a selected-source D1 read and preserves range/UA', async () => {
  const response = await handleLiveProxy(request(), env);
  expect(response?.status).toBe(206);
  if (!response) throw new Error('Missing proxy response');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3])
  );
  expect(response?.headers.get('Content-Range')).toBe('bytes 0-2/9');
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0][0]).toContain('json_each');
  expect(prepare.mock.calls[0][0]).not.toContain('SELECT value FROM settings');
  expect(bind).toHaveBeenCalledWith('tv');
  const headers = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
  expect(headers.get('user-agent')).toBe('ConfiguredPlayer');
  expect(headers.get('range')).toBe('bytes=0-2');
});

it.each([
  '',
  'auth=bad',
  'auth=' +
    encodeURIComponent(
      JSON.stringify({ username: '测试用户', signature: '0'.repeat(64) })
    ),
])('rejects invalid login before D1 or upstream work: %s', async (auth) => {
  expect((await handleLiveProxy(request('segment', auth), env))?.status).toBe(
    401
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('takes a newly disabled source into account on the very next segment', async () => {
  await (await handleLiveProxy(request(), env))?.body?.cancel();
  first.mockResolvedValue(null);
  expect((await handleLiveProxy(request(), env))?.status).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(2);
});

it('uses the shared playlist rewriting and same-origin relocation without dropping source identity', async () => {
  const upstream = new Response(
    '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:12\n#EXTINF:5,\nseg.ts'
  );
  Object.defineProperty(upstream, 'url', {
    value: 'https://backend.test/final/live?token=signed',
  });
  jest.mocked(fetch).mockResolvedValue(upstream);
  const response = await handleLiveProxy(request('m3u8'), env);
  expect(response?.status).toBe(307);
  const location = new URL(response?.headers.get('Location') || '');
  expect(location.origin).toBe('https://tv.test');
  expect(location.searchParams.get('moontv-source')).toBe('tv');
  expect(location.searchParams.get('url')).toBe(
    'https://backend.test/final/live?token=signed'
  );
});

it('leaves non-media and non-D1 requests on the existing application path', async () => {
  expect(
    await handleLiveProxy(new Request('https://tv.test/api/search?q=a'), env)
  ).toBeNull();
  expect(
    await handleLiveProxy(request(), { STORAGE_TYPE: 'localstorage' })
  ).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('fails closed if D1 is unavailable and cancels upstream bodies for HEAD', async () => {
  const response = await handleLiveProxy(
    request('segment', cookie, 'HEAD'),
    env
  );
  expect(response?.status).toBe(206);
  expect(response?.body).toBeNull();
  first.mockRejectedValue(new Error('storage unavailable'));
  expect((await handleLiveProxy(request(), env))?.status).toBe(502);
});
