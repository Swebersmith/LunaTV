/** @jest-environment node */
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));

import { runInThisContext } from 'vm';

import { getConfig } from '@/lib/config';
import {
  fetchLiveUpstream,
  liveProxyContext,
  readLiveText,
  rewriteLivePlaylist,
} from '@/lib/live-proxy';

import { GET as manifest } from '@/app/api/proxy/m3u8/route';
import { GET as segment } from '@/app/api/proxy/segment/route';

Object.assign(
  global,
  runInThisContext(
    '({ Response, Request, Headers, ReadableStream, TextEncoder, TextDecoder })'
  )
);
const originalFetch = global.fetch;
const upstream = 'https://media.test/live/index?token=a%2Fb%25c';
const request = (url = upstream) =>
  new Request(
    'https://tv.test/api/proxy/m3u8?' +
      new URLSearchParams({ url, 'moontv-source': 'live' })
  );
beforeEach(() => {
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ key: 'live', ua: 'TestPlayer' }],
  } as Awaited<ReturnType<typeof getConfig>>);
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('preserves signed URLs without decoding twice and rejects disabled sources', async () => {
  expect((await liveProxyContext(request())).url).toBe(upstream);
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ key: 'live', disabled: true }],
  } as Awaited<ReturnType<typeof getConfig>>);
  expect((await segment(request())).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

it('rewrites master, alternate audio, keys, maps and low-latency resources with source identity', () => {
  const input =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index"\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key?token=a%2Fb"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n\n#comment\nvideo/index\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:URI="part.m4s"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next.m4s"\n#EXT-X-RENDITION-REPORT:URI="other/index"\nseg.ts';
  const output = rewriteLivePlaylist(
    input,
    'https://cdn.test/redirected/index?token=x',
    'https://tv.test',
    'live'
  );
  const links = output.match(/https:\/\/tv\.test[^"\n]+/g) || [];
  expect(links).toHaveLength(9);
  for (const value of links)
    expect(new URL(value).searchParams.get('moontv-source')).toBe('live');
  expect(
    links.filter((value) => new URL(value).pathname.endsWith('/m3u8'))
  ).toHaveLength(3);
  expect(new URL(links[1]).searchParams.get('url')).toBe(
    'https://cdn.test/redirected/key?token=a%2Fb'
  );
  expect(new URL(links[2]).searchParams.get('url')).toBe(
    'https://cdn.test/redirected/video/index'
  );
});

it('does not send HTTP media directly from an HTTPS page, and preserves inline keys', () => {
  const output = rewriteLivePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="data:application/octet-stream;base64,AA=="\nhttp://cdn.test/a.ts\nhttps://cdn.test/b.ts',
    upstream,
    'https://tv.test',
    'live',
    true
  );
  expect(output).toContain('URI="data:');
  expect(output).toContain('https://tv.test/api/proxy/segment?');
  expect(output.endsWith('https://cdn.test/b.ts')).toBe(true);
});

it('pins a redirected playlist to its backend through the authenticated proxy and rewrites relative URLs', async () => {
  const response = new Response('#EXTM3U\n#EXTINF:4,\nseg.ts', {
    headers: { 'Content-Type': 'text/plain', 'Content-Length': '30' },
  });
  Object.defineProperty(response, 'url', {
    value: 'https://cdn.test/final/playlist',
  });
  if (!response.body) throw new Error('Missing response body');
  const cancel = jest.spyOn(response.body, 'cancel');
  const final = new Response('#EXTM3U\n#EXTINF:4,\nseg.ts', {
    headers: { 'Content-Type': 'text/plain', 'Content-Length': '30' },
  });
  Object.defineProperty(final, 'url', {
    value: 'https://cdn.test/final/playlist',
  });
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(final);
  const initial = new URL(request().url);
  initial.searchParams.set('allowCORS', 'true');
  const redirect = await manifest(new Request(initial));
  expect(redirect.status).toBe(307);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(redirect.headers.get('Cache-Control')).toContain('no-store');
  const location = new URL(redirect.headers.get('Location') || '');
  expect(location.origin).toBe('https://tv.test');
  expect(location.pathname).toBe('/api/proxy/m3u8');
  expect(location.searchParams.get('url')).toBe(
    'https://cdn.test/final/playlist'
  );
  expect(location.searchParams.get('moontv-source')).toBe('live');
  expect(location.searchParams.get('allowCORS')).toBe('true');
  // Use full proxy here to inspect rewritten segment URLs as well.
  location.searchParams.delete('allowCORS');
  const result = await manifest(new Request(location));
  expect(result.status).toBe(200);
  expect(result.headers.get('Content-Type')).toBe(
    'application/vnd.apple.mpegurl'
  );
  expect(result.headers.has('Content-Length')).toBe(false);
  expect(await result.text()).toContain(
    encodeURIComponent('https://cdn.test/final/seg.ts')
  );
});

it('streams MP4 and range responses without buffering or cancelling them early', async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });
  jest.mocked(fetch).mockResolvedValue(
    new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-2/9',
        'Content-Length': '3',
      },
    })
  );
  const req = new Request(request(), { headers: { Range: 'bytes=0-2' } });
  const result = await manifest(req);
  expect(result.status).toBe(206);
  expect(result.headers.get('content-range')).toBe('bytes 0-2/9');
  expect(jest.mocked(fetch).mock.calls[0][1]?.headers).toEqual(
    expect.any(Headers)
  );
  expect(
    new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers).get('range')
  ).toBe('bytes=0-2');
  expect(cancel).not.toHaveBeenCalled();
  const reader = result.body?.getReader();
  if (!reader) throw new Error('Missing stream');
  expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
  await reader.cancel();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('cancels failed upstream responses and bounds text memory', async () => {
  const cancel = jest.fn();
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { status: 403 })
    );
  expect((await segment(request())).status).toBe(502);
  expect(cancel).toHaveBeenCalledTimes(1);
  await expect(readLiveText(new Response('too long'), 3)).rejects.toThrow(
    '过大'
  );
});

it('expires stalled headers and stalled playlist bodies', async () => {
  jest.useFakeTimers();
  jest
    .mocked(fetch)
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        )
    );
  const connection = expect(
    fetchLiveUpstream(upstream, 'test', undefined, 50)
  ).rejects.toMatchObject({ status: 504 });
  jest.advanceTimersByTime(51);
  await connection;
  const body = expect(
    readLiveText(new Response(new ReadableStream()), 1024, 50)
  ).rejects.toMatchObject({ status: 504 });
  jest.advanceTimersByTime(51);
  await body;
});
