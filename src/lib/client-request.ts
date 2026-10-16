// The deadline covers both response headers and JSON body consumption.
export async function fetchClientJson<T>(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new Error(`内容加载失败（HTTP ${response.status}），请重试。`);
    return (await response.json()) as T;
  } catch (error) {
    if (timedOut) throw new Error('内容加载超时，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
