let mutations: Promise<unknown> = Promise.resolve();

// Serialise video/live writes in this tab so whole-config saves cannot race.
export function saveSourceChange(
  endpoint: string,
  body: Record<string, unknown>
) {
  const pending = mutations
    .catch(() => undefined)
    .then(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            result.error ||
              (response.status === 401
                ? '登录已失效，请重新登录'
                : `操作失败：${response.status}`)
          );
        return result;
      } catch (cause) {
        if (controller.signal.aborted)
          throw new Error('请求超时，请刷新确认保存结果后再重试');
        throw cause;
      } finally {
        clearTimeout(timer);
      }
    });
  mutations = pending.catch(() => undefined);
  return pending;
}
