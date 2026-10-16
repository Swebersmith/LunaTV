'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DoubanItem } from '@/lib/types';

export interface CategoryPage {
  list: DoubanItem[];
  hasMore?: boolean;
}

export function useCategoryFeed(
  fetchPage: (page: number, signal: AbortSignal) => Promise<CategoryPage>
) {
  const [items, setItems] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state = useRef({
    generation: 0,
    active: false,
    loader: fetchPage,
    busy: true,
    next: 1,
    hasMore: false,
    failedMore: false,
    controller: null as AbortController | null,
  });

  useEffect(() => {
    const current = state.current;
    const generation = ++current.generation;
    const controller = new AbortController();
    current.controller?.abort();
    Object.assign(current, {
      active: true,
      loader: fetchPage,
      busy: true,
      next: 1,
      hasMore: false,
      failedMore: false,
      controller,
    });
    setItems([]);
    setLoading(true);
    setLoadingMore(false);
    setError('');
    setMoreError('');
    setHasMore(false);
    void fetchPage(0, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || current.generation !== generation)
          return;
        setItems(uniqueItems(data.list));
        current.hasMore = data.hasMore ?? data.list.length > 0;
        setHasMore(current.hasMore);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && current.generation === generation)
          setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && current.generation === generation) {
          current.busy = false;
          setLoading(false);
        }
      });
    return () => {
      current.active = false;
      ++current.generation;
      current.controller?.abort();
    };
  }, [fetchPage, attempt]);

  const loadMore = useCallback(
    async (retry = false) => {
      const current = state.current;
      if (
        !current.active ||
        current.loader !== fetchPage ||
        current.busy ||
        !current.hasMore ||
        (current.failedMore && !retry)
      )
        return;
      // Lock synchronously: multiple observer callbacks cannot skip or duplicate pages.
      current.busy = true;
      current.failedMore = false;
      const generation = current.generation;
      const page = current.next;
      const controller = new AbortController();
      current.controller = controller;
      setLoadingMore(true);
      setMoreError('');
      try {
        const data = await fetchPage(page, controller.signal);
        if (controller.signal.aborted || current.generation !== generation)
          return;
        setItems((previous) => uniqueItems([...previous, ...data.list]));
        current.next = page + 1;
        current.hasMore = data.hasMore ?? data.list.length > 0;
        setHasMore(current.hasMore);
      } catch (cause) {
        if (!controller.signal.aborted && current.generation === generation) {
          current.failedMore = true;
          setMoreError(message(cause));
        }
      } finally {
        if (!controller.signal.aborted && current.generation === generation) {
          current.busy = false;
          setLoadingMore(false);
        }
      }
    },
    [fetchPage]
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    items,
    loading,
    loadingMore,
    error,
    moreError,
    hasMore,
    loadMore,
    retry,
  };
}

function uniqueItems(items: DoubanItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id || `${item.title}:${item.year}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : '内容加载失败，请重试或切换分类。';
}
