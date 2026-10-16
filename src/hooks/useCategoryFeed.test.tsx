import { act, renderHook, waitFor } from '@testing-library/react';

import { DoubanItem } from '@/lib/types';

import { CategoryPage, useCategoryFeed } from './useCategoryFeed';

const item = (id: string) =>
  ({ id, title: id, poster: '', rate: '', year: '' } as DoubanItem);
function deferred() {
  let resolve: (value: CategoryPage) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<CategoryPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('cancels old category requests and ignores their errors without ending the new loading state', async () => {
  const old = deferred(),
    next = deferred();
  const a = jest.fn((_page: number, _signal: AbortSignal) => old.promise),
    b = jest.fn((_page: number, _signal: AbortSignal) => next.promise);
  const { result, rerender } = renderHook(
    ({ loader }) => useCategoryFeed(loader),
    { initialProps: { loader: a } }
  );
  rerender({ loader: b });
  expect(a.mock.calls[0][1].aborted).toBe(true);
  await act(async () => old.reject(new Error('old failure')));
  expect(result.current.loading).toBe(true);
  expect(result.current.error).toBe('');
  await act(async () => next.resolve({ list: [item('show')] }));
  expect(result.current.items[0].id).toBe('show');
  expect(result.current.loading).toBe(false);
});

it('ignores obsolete results when changing A to B and back to A', async () => {
  const first = deferred(),
    second = deferred(),
    last = deferred();
  const a = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(last.promise);
  const b = jest.fn(() => second.promise);
  const { result, rerender } = renderHook(
    ({ loader }) => useCategoryFeed(loader),
    { initialProps: { loader: a } }
  );
  rerender({ loader: b });
  rerender({ loader: a });
  await act(async () => last.resolve({ list: [item('fresh')] }));
  await act(async () => {
    first.resolve({ list: [item('stale')] });
    second.resolve({ list: [item('other')] });
  });
  expect(result.current.items.map((value) => value.id)).toEqual(['fresh']);
});

it('shows a recoverable error and retries the same category', async () => {
  const loader = jest
    .fn()
    .mockRejectedValueOnce(new Error('网络失败'))
    .mockResolvedValueOnce({ list: [item('ok')] });
  const { result } = renderHook(() => useCategoryFeed(loader));
  await waitFor(() => expect(result.current.error).toBe('网络失败'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.items[0]?.id).toBe('ok'));
  expect(result.current.error).toBe('');
});

it('locks pagination synchronously and retries the failed page without skipping it', async () => {
  const more = deferred();
  const loader = jest
    .fn()
    .mockResolvedValueOnce({ list: [item('first')] })
    .mockReturnValueOnce(more.promise)
    .mockResolvedValueOnce({ list: [item('first'), item('second')] });
  const { result } = renderHook(() => useCategoryFeed(loader));
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => {
    void result.current.loadMore();
    void result.current.loadMore();
    void result.current.loadMore();
  });
  expect(loader.mock.calls.map((args) => args[0])).toEqual([0, 1]);
  await act(async () => more.reject(new Error('稍后重试')));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(loader).toHaveBeenCalledTimes(2);
  await act(async () => {
    await result.current.loadMore(true);
  });
  expect(loader.mock.calls.map((args) => args[0])).toEqual([0, 1, 1]);
  expect(result.current.items.map((value) => value.id)).toEqual([
    'first',
    'second',
  ]);
});

it('never paginates the anime calendar and aborts work on unmount', async () => {
  const loader = jest
    .fn()
    .mockResolvedValue({ list: [item('calendar')], hasMore: false });
  const { result, unmount } = renderHook(() => useCategoryFeed(loader));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(loader).toHaveBeenCalledTimes(1);
  unmount();
  expect(loader.mock.calls[0][1].aborted).toBe(true);
});
