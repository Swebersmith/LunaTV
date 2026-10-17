// Workers fetch cannot address literal IPs. Use a request-scoped TCP connection
// for these HTTP origins, retaining streaming and cancellation for video data.
export interface LiveSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
  closed: Promise<void>;
}
export type LiveConnect = (
  address: { hostname: string; port: number },
  options: { secureTransport: 'on' | 'off'; allowHalfOpen: boolean }
) => LiveSocket;

// Available in workerd. Other runtimes retain the portable parser below.
declare const FixedLengthStream: new (length: number) => {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

export function isLiveIp(url: URL) {
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('[')
  );
}

function publicIp(hostname: string) {
  if (hostname.startsWith('['))
    return (
      /^\[(?:2|3)[0-9a-f]{3}:/i.test(hostname) &&
      !/^\[2001:db8:/i.test(hostname)
    );
  const [a, b] = hostname.split('.').map(Number);
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}

export async function fetchLiveIp(
  url: URL,
  headers: Headers,
  signal: AbortSignal,
  connect: LiveConnect
): Promise<Response> {
  if (
    !/^https?:$/.test(url.protocol) ||
    !isLiveIp(url) ||
    !publicIp(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('直播地址必须使用公网 IP');
  if (signal.aborted) throw new Error('直播连接已取消');
  const socket = connect(
    {
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    },
    {
      secureTransport: url.protocol === 'https:' ? 'on' : 'off',
      allowHalfOpen: true,
    }
  );
  void socket.closed.catch(() => undefined);
  const reader = socket.readable.getReader();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    void socket.close().catch(() => undefined);
  };
  const abort = () => close();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) close();
  let pending = new Uint8Array(0);
  let offset = 0;
  async function bytes() {
    if (closed || signal.aborted) throw new Error('直播连接已取消');
    if (offset < pending.length) return true;
    const next = await reader.read();
    if (closed || signal.aborted) throw new Error('直播连接已取消');
    pending = next.value || new Uint8Array(0);
    offset = 0;
    return !next.done;
  }
  const headerDecoder = new TextDecoder('latin1');
  function line(limit = 8192): string | Promise<string> {
    const end = pending.indexOf(10, offset);
    if (end >= 0) {
      if (end - offset > limit + 1) throw new Error('直播响应头过大');
      if (end === offset || pending[end - 1] !== 13)
        throw new Error('直播响应行格式错误');
      const text = headerDecoder.decode(pending.subarray(offset, end - 1));
      offset = end + 1;
      return text;
    }
    return fragmentedLine(limit);
  }
  async function fragmentedLine(limit: number): Promise<string> {
    let text = '';
    while (await bytes()) {
      const end = pending.indexOf(10, offset);
      const stop = end < 0 ? pending.length : end;
      text += headerDecoder.decode(pending.subarray(offset, stop));
      offset = stop + (end < 0 ? 0 : 1);
      if (text.length > limit + 1) throw new Error('直播响应头过大');
      if (end >= 0) {
        if (!text.endsWith('\r')) throw new Error('直播响应行格式错误');
        return text.slice(0, -1);
      }
    }
    throw new Error('直播响应意外中断');
  }
  try {
    const writer = socket.writable.getWriter();
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Host', url.host);
    requestHeaders.set('Connection', 'close');
    requestHeaders.set('Accept-Encoding', 'identity');
    const head =
      `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
      Array.from(
        requestHeaders,
        ([name, value]) => `${name}: ${value}\r\n`
      ).join('') +
      '\r\n';
    await writer.write(new TextEncoder().encode(head));
    writer.releaseLock();
    let status = 0;
    let responseHeaders = new Headers();
    let headerSize = 0;
    let interimCount = 0;
    // Consume interim responses before parsing the actual response body.
    do {
      if (++interimCount > 6) throw new Error('直播临时响应次数过多');
      const statusLine = await line();
      const match = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(statusLine);
      if (!match) throw new Error('无效的直播 HTTP 响应');
      status = Number(match[1]);
      responseHeaders = new Headers();
      let item: string;
      while ((item = await line()) !== '') {
        headerSize += item.length + 2;
        if (headerSize > 65536) throw new Error('直播响应头过大');
        const colon = item.indexOf(':');
        if (colon < 1) throw new Error('无效的直播响应头');
        responseHeaders.append(
          item.slice(0, colon),
          item.slice(colon + 1).trim()
        );
      }
    } while (status >= 100 && status < 200 && status !== 101);
    if (status < 200 || status > 599) throw new Error('无效的直播状态码');
    const transfer = responseHeaders.get('transfer-encoding');
    if (transfer && transfer.toLowerCase() !== 'chunked')
      throw new Error('不支持的直播传输编码');
    const chunked = !!transfer;
    const length = responseHeaders.get('content-length');
    if (!chunked && length !== null && !/^\d+$/.test(length))
      throw new Error('无效的直播长度');
    let remaining = !chunked && length !== null ? Number(length) : Infinity;
    if (remaining !== Infinity && !Number.isSafeInteger(remaining))
      throw new Error('无效的直播长度');
    let chunkRemaining = 0;
    let chunkEnd = false;
    const noBody = status === 204 || status === 205 || status === 304;
    let nativeBody: ReadableStream<Uint8Array> | undefined;
    if (
      !noBody &&
      !chunked &&
      remaining !== Infinity &&
      typeof FixedLengthStream === 'function'
    ) {
      // Once headers are consumed, let workerd transfer the socket body in
      // native code. A JS pull/read/enqueue callback for every TCP packet can
      // exhaust a free Worker's CPU budget even when nothing is transcoded.
      const transfer = new FixedLengthStream(remaining);
      const prefix = pending.subarray(offset, offset + remaining);
      reader.releaseLock();
      nativeBody = transfer.readable;
      const pump = async () => {
        const writer = transfer.writable.getWriter();
        try {
          if (prefix.length) await writer.write(prefix);
          if (prefix.length === remaining) {
            await writer.close();
            return;
          }
        } finally {
          writer.releaseLock();
        }
        // The returned response owns this streaming operation; pipeTo carries
        // backpressure, cancellation and fixed-length validation natively.
        await socket.readable.pipeTo(transfer.writable);
      };
      void pump()
        .catch(async (error) => {
          await transfer.writable.abort(error).catch(() => undefined);
        })
        .finally(close);
    }
    const body = noBody
      ? null
      : nativeBody ||
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              // Dechunk into bounded blocks, rather than enqueueing one small
              // TS packet at a time. Buffered framing is parsed synchronously;
              // only an actual socket read needs an asynchronous continuation.
              const output = chunked ? new Uint8Array(64 * 1024) : null;
              let written = 0;
              const flush = () => {
                if (output && written)
                  controller.enqueue(output.subarray(0, written));
              };
              do {
                if (chunked && chunkRemaining === 0) {
                  if (written && pending.indexOf(10, offset) < 0) break;
                  if (chunkEnd) {
                    const ending = line();
                    if (
                      (typeof ending === 'string' ? ending : await ending) !==
                      ''
                    )
                      throw new Error('无效的直播分块结尾');
                    chunkEnd = false;
                  }
                  if (written && pending.indexOf(10, offset) < 0) break;
                  const sizeLine = line();
                  const size = (
                    typeof sizeLine === 'string' ? sizeLine : await sizeLine
                  ).split(';', 1)[0];
                  if (!/^[0-9a-f]+$/i.test(size))
                    throw new Error('无效的直播分块长度');
                  chunkRemaining = parseInt(size, 16);
                  if (!Number.isSafeInteger(chunkRemaining))
                    throw new Error('直播分块过大');
                  if (chunkRemaining === 0) {
                    let trailerSize = 0;
                    let trailer: string;
                    for (;;) {
                      const value = line();
                      trailer = typeof value === 'string' ? value : await value;
                      if (trailer === '') break;
                      trailerSize += trailer.length;
                      if (trailerSize > 65536) throw new Error('直播尾部过大');
                    }
                    flush();
                    controller.close();
                    close();
                    return;
                  }
                }
                if (remaining === 0) {
                  controller.close();
                  close();
                  return;
                }
                if (offset === pending.length && !(await bytes())) {
                  if (chunked || remaining !== Infinity)
                    throw new Error('直播视频数据意外中断');
                  controller.close();
                  close();
                  return;
                }
                const count = Math.min(
                  pending.length - offset,
                  remaining,
                  chunked ? chunkRemaining : Infinity,
                  output ? output.length - written : Infinity
                );
                const data = pending.subarray(offset, offset + count);
                if (output) {
                  output.set(data, written);
                  written += count;
                } else controller.enqueue(data);
                offset += count;
                remaining -= count;
                if (chunked) {
                  chunkRemaining -= count;
                  chunkEnd = true;
                } else if (remaining === 0) {
                  controller.close();
                  close();
                }
              } while (
                output &&
                written < output.length &&
                offset < pending.length
              );
              flush();
            } catch (error) {
              controller.error(error);
              close();
            }
          },
          cancel: close,
        });
    responseHeaders.delete('transfer-encoding');
    if (chunked) responseHeaders.delete('content-length');
    let decoded = body;
    const encoding = responseHeaders.get('content-encoding');
    if (body && encoding && encoding !== 'identity') {
      if (encoding !== 'gzip' && encoding !== 'deflate') {
        await body.cancel();
        throw new Error('不支持的直播压缩编码');
      }
      decoded = body.pipeThrough(new DecompressionStream(encoding));
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
    }
    if (noBody) close();
    const response = new Response(decoded, {
      status,
      headers: responseHeaders,
    });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  } catch (error) {
    close();
    throw error;
  }
}

export async function liveFetch(
  url: string,
  headers: Headers,
  signal: AbortSignal
) {
  // Keep Node/Docker development on its native fetch; import the Workers builtin
  // only in workerd. No socket, reader or in-flight promise is shared by requests.
  const workers =
    typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers';
  let connect: LiveConnect | undefined;
  let target = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    let response: Response;
    if (workers && isLiveIp(target)) {
      if (!connect) {
        const socketModule = 'cloudflare:sockets';
        ({ connect } = await import(/* webpackIgnore: true */ socketModule));
      }
      if (!connect) throw new Error('直播 IP 连接不可用');
      response = await fetchLiveIp(target, headers, signal, connect);
    } else {
      response = await fetch(target.href, {
        headers,
        signal,
        redirect: 'manual',
        cache: 'no-store',
      });
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('直播重定向缺少地址');
    target = new URL(location, target);
    if (!/^https?:$/.test(target.protocol))
      throw new Error('直播重定向协议不受支持');
  }
  throw new Error('直播重定向次数过多');
}
