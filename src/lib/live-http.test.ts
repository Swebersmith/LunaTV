/** @jest-environment node */
import { runInThisContext } from 'vm';
import { gzipSync } from 'zlib';

import { fetchLiveIp, LiveConnect, liveFetch } from './live-http';

Object.assign(
  global,
  runInThisContext(
    '({Response,Request,Headers,ReadableStream,WritableStream,TextEncoder,TextDecoder,DecompressionStream})'
  )
);
const encoder = new TextEncoder();
const url = new URL('http://74.1.2.3:8181/live?token=a%2Fb%25');
function fixture(chunks: Uint8Array[], end = true) {
  const close = jest.fn().mockResolvedValue(undefined);
  const cancel = jest.fn();
  const writes: Uint8Array[] = [];
  let queue: ReadableStreamDefaultController<Uint8Array>;
  const connect: LiveConnect = () => ({
    closed: Promise.resolve(),
    close,
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        queue = controller;
        chunks.forEach((chunk) => controller.enqueue(chunk));
        if (end) controller.close();
      },
      cancel,
    }),
    writable: new WritableStream({
      write(chunk) {
        writes.push(chunk);
      },
    }),
  });
  return {
    connect,
    close,
    cancel,
    writes,
    enqueue: (value: string) => queue.enqueue(encoder.encode(value)),
  };
}
const headers = new Headers({ 'User-Agent': 'LiveTest', Range: 'bytes=0-2' });
it('coalesces thousands of small transport chunks into bounded blocks without changing video bytes', async () => {
  const packet = new Uint8Array(188).fill(47);
  const framing = encoder.encode('bc\r\n');
  const end = encoder.encode('\r\n');
  const count = 4096;
  const raw = Buffer.concat([
    encoder.encode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
    ...Array.from({ length: count }, () =>
      Buffer.concat([framing, packet, end])
    ),
    encoder.encode('0\r\n\r\n'),
  ]);
  const wire = [];
  for (let offset = 0; offset < raw.length; offset += 32768)
    wire.push(raw.subarray(offset, offset + 32768));
  const response = await fetchLiveIp(
    url,
    headers,
    new AbortController().signal,
    fixture(wire).connect
  );
  if (!response.body) throw new Error('Missing body');
  const reader = response.body.getReader();
  const parts = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    expect(value.length).toBeLessThanOrEqual(64 * 1024);
    parts.push(value);
  }
  expect(parts.length).toBeLessThan(256);
  expect(Buffer.concat(parts)).toEqual(Buffer.alloc(count * 188, 47));
});
it('streams an IP origin with signed path, user agent, range and correct URL', async () => {
  const test = fixture(
    [
      encoder.encode(
        'HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 0-2/9\r\n\r\n'
      ),
      new Uint8Array([1, 2, 3]),
    ],
    false
  );
  const response = await fetchLiveIp(
    url,
    headers,
    new AbortController().signal,
    test.connect
  );
  expect(response.status).toBe(206);
  expect(response.url).toBe(url.href);
  expect(response.headers.get('content-range')).toBe('bytes 0-2/9');
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
    1, 2, 3,
  ]);
  const request = new TextDecoder().decode(test.writes[0]);
  expect(request).toContain('GET /live?token=a%2Fb%25 HTTP/1.1');
  expect(request.toLowerCase()).toContain('host: 74.1.2.3:8181');
  expect(request.toLowerCase()).toContain('range: bytes=0-2');
  expect(request.toLowerCase()).toContain('user-agent: livetest');
  expect(test.close).toHaveBeenCalledTimes(1);
});

it('decodes fragmented chunk framing, interim headers, extensions and trailers', async () => {
  const raw =
    'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4;foo=bar\r\nWiki\r\n5\r\npedia\r\n0\r\nX-End: yes\r\n\r\n';
  const test = fixture(Array.from(raw, (char) => encoder.encode(char)));
  const response = await fetchLiveIp(
    url,
    headers,
    new AbortController().signal,
    test.connect
  );
  expect(response.headers.has('transfer-encoding')).toBe(false);
  expect(await response.text()).toBe('Wikipedia');
  expect(test.close).toHaveBeenCalledTimes(1);
});

it('decompresses an origin that ignores identity without retaining compressed length', async () => {
  const gzip = gzipSync('playlist');
  const test = fixture([
    encoder.encode(
      `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${gzip.length}\r\n\r\n`
    ),
    gzip,
  ]);
  const response = await fetchLiveIp(
    url,
    headers,
    new AbortController().signal,
    test.connect
  );
  expect(response.headers.has('content-length')).toBe(false);
  expect(await response.text()).toBe('playlist');
});

it.each([
  'Content-Length: 8\r\n\r\nshort',
  'Transfer-Encoding: chunked\r\n\r\nZ\r\ninvalid',
])('closes a truncated or malformed video stream', async (raw) => {
  const test = fixture([encoder.encode('HTTP/1.1 200 OK\r\n' + raw)]);
  const response = await fetchLiveIp(
    url,
    headers,
    new AbortController().signal,
    test.connect
  );
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect(test.close).toHaveBeenCalledTimes(1);
});

it('cancels an unbounded stream when the viewer leaves, including a pending read', async () => {
  const test = fixture([encoder.encode('HTTP/1.1 200 OK\r\n\r\nvideo')], false);
  const controller = new AbortController();
  const response = await fetchLiveIp(
    url,
    headers,
    controller.signal,
    test.connect
  );
  if (!response.body) throw new Error('Missing stream');
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('video');
  const pending = reader.read();
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(test.close).toHaveBeenCalledTimes(1);
  expect(test.cancel).toHaveBeenCalled();
});

it.each([
  '127.0.0.1',
  '10.1.2.3',
  '169.254.169.254',
  '192.168.1.1',
  '172.16.1.1',
  '[::1]',
  '[::ffff:127.0.0.1]',
])('refuses private or local IP %s before connecting', async (host) => {
  const connect = jest.fn();
  await expect(
    fetchLiveIp(
      new URL(`http://${host}`),
      headers,
      new AbortController().signal,
      connect
    )
  ).rejects.toThrow('公网');
  expect(connect).not.toHaveBeenCalled();
});

it('follows redirects manually so IP redirects can use the same transport', async () => {
  const original = global.fetch;
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: url.href } })
    )
    .mockResolvedValueOnce(new Response('ok'));
  try {
    expect(
      await (
        await liveFetch(
          'https://media.test/live',
          headers,
          new AbortController().signal
        )
      ).text()
    ).toBe('ok');
    expect(jest.mocked(fetch).mock.calls[1][0]).toBe(url.href);
    expect(jest.mocked(fetch).mock.calls[0][1]?.redirect).toBe('manual');
  } finally {
    global.fetch = original;
  }
});
