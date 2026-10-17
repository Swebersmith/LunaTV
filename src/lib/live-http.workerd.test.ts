/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
const { Miniflare } = require(require.resolve('miniflare', {
  paths: [require.resolve('wrangler/package.json')],
}));
const esbuild = require(require.resolve('esbuild', {
  paths: [require.resolve('wrangler/package.json')],
}));

jest.setTimeout(30000);

it('uses native fixed-length streaming in workerd and preserves bytes, truncation errors and cancellation', async () => {
  const built = esbuild.buildSync({
    entryPoints: ['src/lib/live-http.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const runtime = new Miniflare({
    compatibilityDate: '2025-04-01',
    modules: [
      {
        type: 'ESModule',
        path: 'live-http.mjs',
        contents: built.outputFiles[0].text,
      },
      {
        type: 'ESModule',
        path: 'test.mjs',
        contents: `
          import { fetchLiveIp } from './live-http.mjs';
          const NativeStream = FixedLengthStream;
          let nativeCalls = 0;
          globalThis.FixedLengthStream = function(length) {
            nativeCalls++;
            return new NativeStream(length);
          };
          export default { async fetch(request) {
            let closed = 0;
            const path = new URL(request.url).pathname;
            const signal = new AbortController();
            const prefix = new TextEncoder().encode('HTTP/1.1 200 OK\\r\\nContent-Length: 8\\r\\n\\r\\nAB');
            const connect = () => ({
              closed: Promise.resolve(),
              close() { closed++; return Promise.resolve(); },
              readable: new ReadableStream({ start(controller) {
                controller.enqueue(prefix);
                if (path !== '/short') controller.enqueue(new TextEncoder().encode('CDEFGH'));
                if (path !== '/abort') controller.close();
              }}),
              writable: new WritableStream(),
            });
            const response = await fetchLiveIp(new URL('http://74.1.2.3/live'), new Headers(), signal.signal, connect);
            if (path === '/abort') {
              signal.abort();
              await response.body.cancel();
              return Response.json({ closed, nativeCalls });
            }
            response.headers.set('X-Native-Calls', String(nativeCalls));
            return response;
          }};
        `,
      },
    ].reverse(),
  });
  try {
    const response = await runtime.dispatchFetch('https://test/complete', {
      headers: { 'Accept-Encoding': 'identity' },
    });
    expect(response.headers.get('X-Native-Calls')).toBe('1');
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(await response.text()).toBe('ABCDEFGH');
    const short = await runtime.dispatchFetch('https://test/short', {
      headers: { 'Accept-Encoding': 'identity' },
    });
    await expect(short.text()).rejects.toThrow();
    const abort = await runtime.dispatchFetch('https://test/abort');
    const result = await abort.json();
    expect(result.closed).toBe(1);
    expect(result.nativeCalls).toBe(3);
  } finally {
    await runtime.dispose();
  }
});
