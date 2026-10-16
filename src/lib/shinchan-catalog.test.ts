import {
  buildShinchanCollection,
  getShinchanMovie,
  getShinchanSeason,
  isShinchanVideo,
  normalizeShinchanTitle,
  SHINCHAN_MOVIES,
  shinchanPlaybackUrl,
} from './shinchan-catalog';
import type { SearchResult } from './types';

function video(
  title: string,
  count = 1,
  source = 'one',
  id = title
): SearchResult {
  return {
    title,
    id,
    source,
    source_name: source,
    year: '',
    poster: '',
    episodes: Array.from(
      { length: count },
      () => 'https://example.test/video.m3u8'
    ),
    episodes_titles: [],
  };
}

it('covers each release year, including the 3DCG film, without inventing a playable source', () => {
  expect(SHINCHAN_MOVIES.map((movie) => movie.year)).toEqual(
    Array.from({ length: 34 }, (_, i) => 1993 + i)
  );
  expect(buildShinchanCollection([]).movies.size).toBe(0);
});

it('matches regional movie titles and traditional Chinese without confusing television seasons', () => {
  expect(normalizeShinchanTitle('蠟筆小新：我們的恐龍日記')).toBe(
    '蜡笔小新我们的恐龙日记'
  );
  expect(
    getShinchanMovie(video('蜡笔小新：新婚旅行风暴～夺回广志大作战～'))?.year
  ).toBe(2019);
  expect(getShinchanMovie(video('蜡笔小新：好别致的影分身'))?.year).toBe(2022);
  expect(getShinchanMovie(video('蜡笔小新：新次元！超能力大决战'))?.year).toBe(
    2023
  );
  expect(getShinchanMovie(video('蜡笔小新第十季', 156))).toBeUndefined();
  expect(getShinchanMovie(video('蜡笔小新：未知新电影'))).toBeUndefined();
});

it('excludes unrelated films, commentary, trailers and unplayable results', () => {
  expect(isShinchanVideo(video('蜡笔和小新的故事'))).toBe(false);
  expect(isShinchanVideo(video('蜡笔小新：我们的恐龙日记[电影解说]'))).toBe(
    false
  );
  expect(isShinchanVideo(video('蠟筆小新：新次元！超能力大決戰[預告片]'))).toBe(
    false
  );
  expect(isShinchanVideo(video('蜡笔小新第一季', 0))).toBe(false);
});

it('recognizes Chinese and numeric seasons and groups language versions in season order', () => {
  expect(getShinchanSeason('蜡笔小新第十季')).toBe(10);
  expect(getShinchanSeason('蜡笔小新第8季（中文）')).toBe(8);
  expect(getShinchanSeason('Crayon Shinchan Season 12')).toBe(12);
  expect(getShinchanSeason('蜡笔小新第十一季')).toBe(11);
  const record = video('蜡笔小新第一季', 480);
  const collection = buildShinchanCollection([
    video('蜡笔小新第十季', 104),
    record,
    record,
    video('蜡笔小新第一季（中文）', 156, 'two'),
  ]);
  expect(collection.series.map((group) => group.season)).toEqual([1, 10]);
  expect(
    collection.series[0].results.map((result) => result.episodes.length)
  ).toEqual([480, 156]);
});

it('keeps movie bundles and extra stories separate and retains alternative sources', () => {
  const collection = buildShinchanCollection([
    video('蜡笔小新剧场版合集', 21),
    video('蜡笔小新外传2 玩具大战', 13),
    video('蜡笔小新：我们的恐龙日记'),
    video('蜡笔小新：我们的恐龙日记', 1, 'two'),
  ]);
  expect(collection.bundles).toHaveLength(1);
  expect(collection.extras).toHaveLength(1);
  expect(collection.series).toHaveLength(0);
  expect(collection.movies.get(2024)).toHaveLength(2);
});

it('links the exact provider result to the player and returns to the collection', () => {
  const result = video('蜡笔小新 第十季', 156, 'source-key', 'vod-123');
  const url = new URL(shinchanPlaybackUrl(result), 'https://example.test');
  expect(url.pathname).toBe('/play');
  expect(url.searchParams.get('source')).toBe('source-key');
  expect(url.searchParams.get('id')).toBe('vod-123');
  expect(url.searchParams.get('title')).toBe('蜡笔小新 第十季');
  expect(url.searchParams.get('returnTo')).toBe('/shinchan');
});
