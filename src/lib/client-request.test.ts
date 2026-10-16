import { fetchClientJson } from './client-request';

const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it('keeps the timeout active while the JSON body is stalled', async () => {
  jest
    .mocked(fetch)
    .mockImplementation(
      async (_url, options) =>
        ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) =>
              options?.signal?.addEventListener('abort', () =>
                reject(new Error('abort'))
              )
            ),
        } as Response)
    );
  const loading = expect(
    fetchClientJson('/api/test', undefined, 50)
  ).rejects.toThrow('超时');
  await Promise.resolve();
  jest.advanceTimersByTime(51);
  await loading;
  expect(jest.getTimerCount()).toBe(0);
});

it('propagates category cancellation and cleans up its deadline', async () => {
  jest
    .mocked(fetch)
    .mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('cancelled'))
          )
        )
    );
  const controller = new AbortController();
  const result = expect(
    fetchClientJson('/api/test', controller.signal)
  ).rejects.toThrow('cancelled');
  controller.abort();
  await result;
  expect(jest.getTimerCount()).toBe(0);
});

it('rejects failed HTTP responses and returns valid JSON', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ list: [] }),
    } as Response);
  await expect(fetchClientJson('/api/test')).rejects.toThrow('503');
  await expect(fetchClientJson('/api/test')).resolves.toEqual({ list: [] });
  expect(jest.getTimerCount()).toBe(0);
});
