import {
  discoverShinchanVideos,
  SHINCHAN_SEARCH_TERMS,
} from './shinchan-client';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('discovers page 6 and new seasons in all language variants with at most four concurrent requests', async () => {
  const calls: URL[] = [];
  let active = 0,
    peak = 0;
  global.fetch = jest.fn(async (input) => {
    const url = new URL(String(input), 'https://example.test');
    calls.push(url);
    if (!url.searchParams.has('source'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ sources: [{ key: 'one', name: 'One' }] }),
      } as Response;
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    const page = Number(url.searchParams.get('page'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        pageCount: 6,
        results:
          page === 6
            ? [
                {
                  source: 'one',
                  id: 'season12',
                  title: '蜡笔小新第12季',
                  episodes: ['episode'],
                  episodes_titles: [],
                  year: '2028',
                  poster: '',
                  source_name: 'One',
                },
              ]
            : [],
      }),
    } as Response;
  });
  const result = await discoverShinchanVideos(new AbortController().signal);
  expect(result.results.some((video) => video.id === 'season12')).toBe(true);
  expect(calls.filter((url) => url.searchParams.has('source'))).toHaveLength(
    18
  );
  expect(
    new Set(calls.map((url) => url.searchParams.get('q')).filter(Boolean))
  ).toEqual(new Set(SHINCHAN_SEARCH_TERMS));
  expect(peak).toBeLessThanOrEqual(4);
  expect(result.partial).toBe(false);
});

it('reports partial source failures without deleting successful discoveries', async () => {
  global.fetch = jest.fn(async (input) => {
    const url = new URL(String(input), 'https://example.test');
    if (!url.searchParams.has('source'))
      return {
        ok: true,
        json: async () => ({ sources: [{ key: 'one' }] }),
      } as Response;
    if (url.searchParams.get('q') === '蜡笔小新') throw new Error('offline');
    return {
      ok: true,
      json: async () => ({ pageCount: 1, results: [] }),
    } as Response;
  });
  expect(
    (await discoverShinchanVideos(new AbortController().signal)).partial
  ).toBe(true);
});
