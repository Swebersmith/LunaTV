import { isShinchanVideo } from './shinchan-catalog';
import type { SearchResult } from './types';

export const SHINCHAN_SEARCH_TERMS = [
  '蜡笔小新',
  '蠟筆小新',
  'クレヨンしんちゃん',
];
const MAX_PAGES = 100;

async function json(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (response.status === 401) throw new Error('登录状态已失效，请重新登录。');
  if (!response.ok) throw new Error('片源暂不可用');
  return response.json();
}

export async function discoverShinchanVideos(
  signal: AbortSignal
): Promise<{ results: SearchResult[]; partial: boolean }> {
  const data = await json('/api/shinchan/search', signal);
  if (!Array.isArray(data.sources)) throw new Error('片源列表格式异常');
  const jobs: { source: string; query: string; page: number }[] =
    data.sources.flatMap((source: { key: string }) =>
      SHINCHAN_SEARCH_TERMS.map((query) => ({
        source: source.key,
        query,
        page: 1,
      }))
    );
  const results: SearchResult[] = [];
  let cursor = 0,
    successes = 0,
    partial = false;
  const errors: Error[] = [];
  const worker = async () => {
    while (cursor < jobs.length && !signal.aborted) {
      const job = jobs[cursor++];
      try {
        const params = new URLSearchParams({
          source: job.source,
          q: job.query,
          page: String(job.page),
        });
        const page = await json(`/api/shinchan/search?${params}`, signal);
        if (!Array.isArray(page.results)) throw new Error('片源返回格式异常');
        successes++;
        results.push(
          ...(page.results as SearchResult[]).filter(isShinchanVideo)
        );
        if (job.page === 1) {
          const pages = Math.max(1, Math.floor(Number(page.pageCount) || 1));
          if (pages > MAX_PAGES) partial = true;
          for (let next = 2; next <= Math.min(pages, MAX_PAGES); next++)
            jobs.push({ ...job, page: next });
        }
      } catch (error) {
        if (signal.aborted) throw error;
        partial = true;
        errors.push(error instanceof Error ? error : new Error('片源暂不可用'));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  if (!successes && jobs.length) throw errors[0] || new Error('片源暂不可用');
  return { results, partial };
}
