'use client';

import { useEffect, useState } from 'react';

import { SearchResult } from '@/lib/types';

function streamingEnabled() {
  try {
    const saved = localStorage.getItem('fluidSearch');
    if (saved !== null) return JSON.parse(saved) !== false;
  } catch {
    /* Ignore a malformed preference. */
  }
  return (
    (window as Window & { RUNTIME_CONFIG?: { FLUID_SEARCH?: boolean } })
      .RUNTIME_CONFIG?.FLUID_SEARCH !== false
  );
}

function mergeResults(
  previous: SearchResult[],
  incoming: SearchResult[],
  query: string
) {
  const merged = new Map(
    previous.map((item) => [`${item.source}\0${item.id}`, item])
  );
  const sorted = incoming.slice().sort((a, b) => {
    const exact =
      Number(b.title.trim() === query) - Number(a.title.trim() === query);
    if (exact) return exact;
    return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
  });
  sorted.forEach((item) => merged.set(`${item.source}\0${item.id}`, item));
  return Array.from(merged.values());
}

export function useVideoSearch(query: string, attempt: number) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    let finished = false;
    let fallbackStarted = false;
    let es: EventSource | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let buffer: SearchResult[] = [];
    const controller = new AbortController();
    const trimmed = query.trim();
    setResults([]);
    setError('');
    setNotice('');
    setTotalSources(0);
    setCompletedSources(0);
    setLoading(Boolean(trimmed));
    const useStream = streamingEnabled();
    setStreaming(useStream);

    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (active && buffer.length) {
        const incoming = buffer;
        buffer = [];
        setResults((previous) => mergeResults(previous, incoming, trimmed));
      }
    };
    const stopStream = () => {
      es?.close();
      clearTimeout(startupTimer);
      clearTimeout(deadline);
    };
    const searchNormally = async () => {
      if (!active || finished || fallbackStarted) return;
      fallbackStarted = true;
      stopStream();
      flush();
      setStreaming(false);
      if (useStream) setNotice('连接不稳定，正在使用普通搜索…');
      deadline = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? '登录已失效，请重新登录后搜索'
              : `搜索失败（${response.status}），请重试`
          );
        const data = await response.json();
        if (!Array.isArray(data.results))
          throw new Error('搜索返回异常，请重试');
        if (!active) return;
        setResults((previous) => mergeResults(previous, data.results, trimmed));
        setTotalSources(1);
        setCompletedSources(1);
        setNotice('');
      } catch (cause) {
        if (active)
          setError(
            controller.signal.aborted
              ? '搜索超时，请重试或更换关键词'
              : cause instanceof Error
              ? cause.message
              : '搜索连接失败，请重试'
          );
      } finally {
        clearTimeout(deadline);
        if (active) {
          finished = true;
          setLoading(false);
          setNotice('');
        }
      }
    };

    if (trimmed && useStream && typeof EventSource !== 'undefined') {
      try {
        es = new EventSource(`/api/search/ws?q=${encodeURIComponent(trimmed)}`);
        startupTimer = setTimeout(searchNormally, 8000);
        deadline = setTimeout(searchNormally, 30000);
        es.onmessage = (event) => {
          if (!active || finished || fallbackStarted) return;
          try {
            const payload = JSON.parse(event.data);
            clearTimeout(startupTimer);
            if (payload.type === 'start')
              setTotalSources(payload.totalSources || 0);
            else if (
              payload.type === 'source_result' ||
              payload.type === 'source_error'
            ) {
              setCompletedSources((previous) => previous + 1);
              if (Array.isArray(payload.results))
                buffer.push(...payload.results);
              if (!flushTimer) flushTimer = setTimeout(flush, 80);
            } else if (payload.type === 'complete') {
              flush();
              finished = true;
              stopStream();
              setLoading(false);
              setCompletedSources(payload.completedSources ?? 0);
            }
          } catch {
            void searchNormally();
          }
        };
        es.onerror = () => {
          void searchNormally();
        };
      } catch {
        void searchNormally();
      }
    } else if (trimmed) {
      void searchNormally();
    }

    return () => {
      active = false;
      stopStream();
      controller.abort();
      clearTimeout(flushTimer);
      buffer = [];
    };
  }, [query, attempt]);

  return {
    results,
    loading,
    streaming,
    totalSources,
    completedSources,
    error,
    notice,
  };
}
