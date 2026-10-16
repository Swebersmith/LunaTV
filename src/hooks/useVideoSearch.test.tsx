import { act, renderHook, waitFor } from '@testing-library/react';

import { SearchResult } from '@/lib/types';

import { useVideoSearch } from './useVideoSearch';

class FakeStream {
  static instances: FakeStream[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();
  constructor(readonly url: string) {
    FakeStream.instances.push(this);
  }
  message(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}
const originalFetch = global.fetch;
const originalStream = global.EventSource;
const video = (id: string, title = id) =>
  ({
    id,
    source: 'one',
    title,
    year: '2026',
    episodes: ['https://example.test/video.m3u8'],
  } as SearchResult);
const response = (results: SearchResult[]) =>
  ({ ok: true, json: async () => ({ results }) } as Response);
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  FakeStream.instances = [];
  global.fetch = jest.fn();
  global.EventSource = FakeStream as unknown as typeof EventSource;
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  global.EventSource = originalStream;
});

it('starts a new request for the same keyword when the user retries', async () => {
  localStorage.setItem('fluidSearch', 'false');
  jest.mocked(fetch).mockResolvedValue(response([video('first')]));
  const { result, rerender } = renderHook(
    ({ attempt }) => useVideoSearch('小新', attempt),
    { initialProps: { attempt: 0 } }
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  jest.mocked(fetch).mockResolvedValue(response([video('second')]));
  rerender({ attempt: 1 });
  await waitFor(() => expect(result.current.results[0].id).toBe('second'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('ignores stale results even when the user changes A to B and back to A', async () => {
  localStorage.setItem('fluidSearch', 'false');
  const first = deferred<Response>(),
    second = deferred<Response>(),
    third = deferred<Response>();
  jest
    .mocked(fetch)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  const { result, rerender } = renderHook(
    ({ query }) => useVideoSearch(query, 0),
    { initialProps: { query: 'A' } }
  );
  rerender({ query: 'B' });
  rerender({ query: 'A' });
  await act(async () => {
    third.resolve(response([video('latest')]));
  });
  await act(async () => {
    first.resolve(response([video('outdated')]));
    second.resolve(response([video('other')]));
  });
  expect(result.current.results.map((item) => item.id)).toEqual(['latest']);
  expect(result.current.loading).toBe(false);
  expect(jest.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it('falls back once after a broken stream and deduplicates partial results', async () => {
  jest.mocked(fetch).mockResolvedValue(response([video('same'), video('new')]));
  const { result } = renderHook(() => useVideoSearch('小新', 0));
  const stream = FakeStream.instances[0];
  act(() => {
    stream.message({ type: 'start', totalSources: 2 });
    stream.message({ type: 'source_result', results: [video('same')] });
  });
  await act(async () => {
    stream.onerror?.();
    stream.onerror?.();
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.results.map((item) => item.id)).toEqual([
    'same',
    'new',
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(stream.close).toHaveBeenCalled();
});

it('falls back when a connection stays silent and aborts a hung fallback with a visible error', async () => {
  jest
    .mocked(fetch)
    .mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        )
    );
  const { result } = renderHook(() => useVideoSearch('小新', 0));
  await act(async () => {
    jest.advanceTimersByTime(8000);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.current.notice).toContain('普通搜索');
  await act(async () => {
    jest.advanceTimersByTime(25000);
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('超时');
});

it('finishes an empty stream and clears its deadlines without launching another search', async () => {
  const { result } = renderHook(() => useVideoSearch('小新', 0));
  act(() => {
    FakeStream.instances[0].message({ type: 'start', totalSources: 0 });
    FakeStream.instances[0].message({ type: 'complete', completedSources: 0 });
    jest.advanceTimersByTime(40000);
  });
  expect(result.current.loading).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('reports login failures and tolerates an invalid local search preference', async () => {
  localStorage.setItem('fluidSearch', 'false');
  jest.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
  const { result, unmount } = renderHook(() => useVideoSearch('小新', 0));
  await waitFor(() => expect(result.current.error).toContain('登录已失效'));
  expect(result.current.loading).toBe(false);
  unmount();
  localStorage.setItem('fluidSearch', 'not-json');
  renderHook(() => useVideoSearch('小新', 0));
  expect(FakeStream.instances).toHaveLength(1);
});

it('closes and aborts previous work when navigating to an empty search page', () => {
  const { result, rerender } = renderHook(
    ({ query }) => useVideoSearch(query, 0),
    { initialProps: { query: '小新' } }
  );
  rerender({ query: '' });
  expect(FakeStream.instances[0].close).toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.results).toEqual([]);
});
