/** @jest-environment node */
import { mergeShinchanMovies, SHINCHAN_MOVIES } from './shinchan-catalog';
import {
  getShinchanCatalog,
  parseBangumiMovies,
  parseOfficialHistory,
} from './shinchan-metadata';

it('parses official release history without guessing one movie per year', () => {
  const html =
    Array.from(
      { length: 20 },
      (_, i) =>
        `<div>${
          1993 + i
        }年</div><div>7月</div><div>劇場映画『作品名${i}』公開</div>`
    ).join('') +
    '<div>2028年</div><div>8月</div><div>劇場映画『未来星空大冒険』公開</div><div>劇場映画『春日部の新冒険』公開</div><div>劇場映画『過去の映画』を実写化した『BALLAD』公開</div>';
  const movies = parseOfficialHistory(html);
  expect(movies.filter((movie) => movie.year === 2028)).toHaveLength(2);
  expect(movies[20].releaseDate).toBe('2028-08');
  expect(() =>
    parseOfficialHistory('<h1>Service temporarily unavailable</h1>')
  ).toThrow();
});

it('uses movie metadata and Chinese/Japanese aliases, excluding TV and unrelated subjects', () => {
  const movies = parseBangumiMovies([
    {
      id: 1,
      type: 2,
      platform: '剧场版',
      name: 'クレヨンしんちゃん 未来星空大冒険',
      name_cn: '蜡笔小新：未来星空大冒险',
      date: '2028-08-01',
    },
    {
      id: 2,
      type: 2,
      platform: 'TV',
      name: 'クレヨンしんちゃん',
      date: '1992-04-13',
    },
    {
      id: 3,
      type: 2,
      platform: '剧场版',
      name: '其他动画',
      date: '2028-01-01',
    },
  ]);
  expect(movies).toHaveLength(1);
  expect(movies[0].title).toBe('未来星空大冒险');
  expect(movies[0].aliases).toContain('クレヨンしんちゃん 未来星空大冒険');
});

it('reuses metadata until its refresh deadline and keeps new entries during an upstream outage', async () => {
  const snapshot = {
    movies: mergeShinchanMovies(SHINCHAN_MOVIES, [
      { id: 'future', year: 2028, title: '未来星空大冒险', aliases: [] },
    ]),
    checkedAt: '2028-01-01T00:00:00.000Z',
    nextCheckAt: '2028-01-01T06:00:00.000Z',
    status: 'current',
    official: true,
    bangumi: true,
  };
  const cache = {
    match: jest.fn().mockResolvedValue({ json: async () => snapshot }),
    put: jest.fn(),
  };
  const fetcher = jest.fn().mockRejectedValue(new Error('offline'));
  const fresh = await getShinchanCatalog('https://example.test', {
    cache,
    fetcher,
    now: Date.parse('2028-01-01T05:00:00Z'),
  });
  expect(fresh.movies.some((movie) => movie.id === 'future')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  // Both upstreams fail before any response is buffered, so no Response polyfill is needed.
  const stale = await getShinchanCatalog('https://example.test', {
    cache,
    fetcher,
    now: Date.parse('2028-01-02T00:00:00Z'),
  });
  expect(stale.status).toBe('stale');
  expect(stale.movies.some((movie) => movie.id === 'future')).toBe(true);
  expect(Date.parse(stale.nextCheckAt) - Date.parse(stale.checkedAt)).toBe(
    300000
  );
});
