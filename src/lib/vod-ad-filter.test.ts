import { markVodAds, skipVodAd } from './vod-ad-filter';

const url = 'https://media.test/video/program/episode/index.m3u8';

function playlist() {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:20',
    '#EXT-X-DISCONTINUITY-SEQUENCE:7',
    ...Array.from({ length: 50 }, (_, i) => `#EXTINF:6,\nmain${i}.ts`),
    '#EXTINF:1.88,',
    'before.ts',
    '#EXT-X-DISCONTINUITY',
    ...Array.from(
      { length: 9 },
      (_, i) => `#EXTINF:${i === 8 ? 2.04 : 3},\n/video/adjump/time/ad${i}.ts`
    ),
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:6,',
    'after.ts',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}

it('marks the nine confirmed ad segments as gaps without removing any original metadata', () => {
  const original = playlist();
  const marked = markVodAds(original, url);
  expect(marked.ranges).toHaveLength(1);
  expect(marked.ranges[0].start).toBeCloseTo(301.88);
  expect(marked.ranges[0].end).toBeCloseTo(327.92);
  expect(marked.playlist.match(/^#EXT-X-GAP$/gm)).toHaveLength(9);
  expect(marked.playlist.replace(/^#EXT-X-GAP\n/gm, '')).toBe(original);
  expect(markVodAds(marked.playlist, url)).toEqual(marked);
});

it('preserves CRLF, encrypted IV/sequence state, byte ranges and init maps', () => {
  const original = playlist()
    .replace(
      '#EXTINF:1.88,',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-BYTERANGE:1024@0\n#EXTINF:1.88,'
    )
    .replace(/\n/g, '\r\n');
  const marked = markVodAds(original, url);
  expect(marked.ranges).toHaveLength(1);
  expect(marked.playlist.replace(/^#EXT-X-GAP\r\n/gm, '')).toBe(original);
});

it('leaves ordinary discontinuities, unknown paths, query parameters and other origins alone', () => {
  const original = playlist().replace(
    /\/video\/adjump\/time\/ad\d+\.ts/g,
    'https://other.test/video/adjump/time/ad.ts'
  );
  expect(markVodAds(original, url)).toEqual({ playlist: original, ranges: [] });
  for (const replacement of [
    'main-ad.ts',
    'main.ts?next=/video/adjump/time/ad.ts',
    '/ads/scene.ts',
  ]) {
    const normal = playlist().replace(
      /\/video\/adjump\/time\/ad\d+\.ts/g,
      replacement
    );
    expect(markVodAds(normal, url)).toEqual({ playlist: normal, ranges: [] });
  }
});

it('supports absolute ad URLs and signed query parameters on the same origin', () => {
  const original = playlist().replace(
    /\/video\/adjump\/time\/ad(\d+)\.ts/g,
    'https://media.test/video/adjump/time/ad$1.ts?token=example'
  );
  expect(markVodAds(original, url).ranges).toHaveLength(1);
});

it('never changes live or master playlists and leaves malformed segment durations alone', () => {
  const live = playlist().replace('#EXT-X-ENDLIST', '');
  const malformed = playlist().replace('#EXTINF:1.88,', '#EXTINF:NaN,');
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8\n';
  for (const original of [live, malformed, master])
    expect(markVodAds(original, url)).toEqual({
      playlist: original,
      ranges: [],
    });
});

it('jumps from the reported 5:03 ad to the complete ad break end, including seeks into ads', () => {
  const video = { currentTime: 303, duration: 4701.08 };
  const { ranges } = markVodAds(playlist(), url);
  expect(skipVodAd(video, ranges)).toBe(true);
  expect(video.currentTime).toBeCloseTo(327.94);
  expect(skipVodAd(video, ranges)).toBe(false);
  video.currentTime = 310;
  expect(skipVodAd(video, ranges)).toBe(true);
  video.currentTime = 100;
  expect(skipVodAd(video, ranges)).toBe(false);
  expect(video.currentTime).toBe(100);
  video.currentTime = 303;
  video.duration = NaN;
  expect(skipVodAd(video, ranges)).toBe(false);
});

it('merges adjacent ad segments but preserves normal video between two ad breaks', () => {
  const original = playlist().replace(
    '#EXT-X-ENDLIST',
    '#EXTINF:3,\n/video/adjump/time/tail.ts\n#EXTINF:3,\nend.ts\n#EXT-X-ENDLIST'
  );
  const { ranges } = markVodAds(original, url);
  expect(ranges).toHaveLength(2);
  expect(ranges[1].start - ranges[0].end).toBeCloseTo(6);
});
