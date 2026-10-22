import { adFixture } from './__fixtures__/vod-playlist';
import {
  filteredToSourceTime,
  filterVodAdSegments,
  sourceToFilteredTime,
} from './vod-segment-filter';

it('removes actual advertising URIs and durations rather than just discontinuity tags', () => {
  const input = adFixture();
  const result = filterVodAdSegments(input);
  expect(result.reason).toBe('filtered');
  expect(result.playlist).not.toContain('insert-');
  expect(result.playlist).toContain('before-23.ts');
  expect(result.playlist).toContain('after-0.ts');
  expect(result.playlist.match(/#EXT-X-DISCONTINUITY\n/g)).toHaveLength(2);
  expect(result.originalDuration).toBeCloseTo(48 * 6.006 + 12.5);
  expect(result.removed[0].start).toBeCloseTo(24 * 6.006);
  expect(result.removed[0].end - result.removed[0].start).toBeCloseTo(12.5);
  expect(filterVodAdSegments(result.playlist).playlist).toBe(result.playlist);
});

it.each([
  ['ordinary discontinuities', { adDurations: [6.006, 6.006, 6.006] }],
  [
    'different normal movie directories',
    { adPath: '/another-camera', adDurations: [6.006, 6.006, 6.006] },
  ],
  ['short final movie segment', { adDurations: [0.5] }],
  ['short clips without enough programme evidence', { before: 2, after: 2 }],
  [
    'too much content selected by heuristics',
    { before: 8, after: 8, adDurations: [6, 6, 6, 6, 6, 6, 6, 1] },
  ],
] as const)('keeps %s intact', (_name, options) => {
  const playlist = adFixture({
    ...options,
    ...('adDurations' in options
      ? { adDurations: [...options.adDurations] }
      : {}),
  });
  expect(filterVodAdSegments(playlist).playlist).toBe(playlist);
});

it('uses repeated duration fingerprints to detect short insertions on a different path', () => {
  const main = Array.from(
    { length: 24 },
    (_, i) => `#EXTINF:6.006,\n/movie/part-${i}.ts`
  ).join('\n');
  const ad = '#EXTINF:2.04,\n/other/x.ts\n#EXTINF:3.04,\n/other/y.ts';
  const input = `#EXTM3U\n#EXT-X-TARGETDURATION:7\n${main}\n#EXT-X-DISCONTINUITY\n${ad}\n#EXT-X-DISCONTINUITY\n${main}\n#EXT-X-DISCONTINUITY\n${ad}\n#EXT-X-DISCONTINUITY\n${main}\n#EXT-X-ENDLIST\n`;
  const result = filterVodAdSegments(input);
  expect(result.removed).toHaveLength(2);
  expect(result.playlist).not.toContain('/other/');
  const single = input.replace(ad, '#EXTINF:2.08,\n/other/changed.ts');
  expect(filterVodAdSegments(single).removed).toHaveLength(0);
});

it('recognizes known future-year insertion paths without treating arbitrary ad-like names as evidence', () => {
  const result = filterVodAdSegments(
    adFixture({ adPath: '/2099/05/video', adDurations: [2.04, 3.04] })
  );
  expect(result.playlist).not.toContain('/2099/05/video');
  const normal = adFixture({ adPath: '/adventure', adDurations: [2.04, 3.04] });
  expect(filterVodAdSegments(normal).playlist).toBe(normal);
});

it.each([
  ['rolling live', (s: string) => s.replace('#EXT-X-ENDLIST', '')],
  [
    'fMP4 init maps',
    (s: string) =>
      s.replace(
        '#EXT-X-TARGETDURATION:7',
        '#EXT-X-TARGETDURATION:7\n#EXT-X-MAP:URI="init.mp4"'
      ),
  ],
  [
    'implicit byte ranges',
    (s: string) => s.replace('#EXTINF:2,', '#EXT-X-BYTERANGE:1000\n#EXTINF:2,'),
  ],
  [
    'low-latency parts',
    (s: string) =>
      s.replace(
        '#EXT-X-ENDLIST',
        '#EXT-X-PART:DURATION=0.5,URI="p.ts"\n#EXT-X-ENDLIST'
      ),
  ],
  [
    'DRM',
    (s: string) =>
      s.replace(
        '#EXT-X-VERSION:3',
        '#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset"'
      ),
  ],
  ['invalid durations', (s: string) => s.replace('#EXTINF:2,', '#EXTINF:NaN,')],
  [
    'unsafe media sequence',
    (s: string) => s.replace('SEQUENCE:20', 'SEQUENCE:9007199254740992'),
  ],
  [
    'master playlists',
    (s: string) =>
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123456\nvideo.m3u8\n' + s,
  ],
])(
  'passes %s through without corrupting shared playlist state',
  (_name, mutate) => {
    const input = mutate(adFixture());
    expect(filterVodAdSegments(input).playlist).toBe(input);
    expect(filterVodAdSegments(input).removed).toEqual([]);
  }
);

it('preserves original sequence-derived AES-128 IVs after removing seven segments', () => {
  const key = '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?signature=a%2Fb&x=1"';
  const result = filterVodAdSegments(adFixture({ key }));
  // Original sequence: 20 + 24 programme segments + 7 ads = 51 (0x33).
  expect(result.playlist).toContain(
    `${key},IV=0x00000000000000000000000000000033\n#EXTINF:6.006,\n/video/after-0.ts`
  );
});

it('retains key rotation/explicit IVs and programme boundaries when an ad is unencrypted', () => {
  const key =
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001';
  const original = adFixture({ key })
    .replace('#EXTINF:2,', '#EXT-X-KEY:METHOD=NONE\n#EXTINF:2,')
    .replace(
      '#EXTINF:6.006,\n/video/after-0.ts',
      `${key}\n#EXTINF:6.006,\n/video/after-0.ts`
    );
  const result = filterVodAdSegments(original);
  expect(result.reason).toBe('filtered');
  expect(result.playlist).not.toContain('METHOD=NONE');
  expect(result.playlist).toContain(key);
  expect(result.playlist).not.toContain('insert-');
});

it('keeps CRLF/signatures byte-for-byte when no ad group is matched', () => {
  const input = adFixture({ adDurations: [6.006] })
    .replace(/\.ts/g, '.ts?token=a%2Fb&name=%E4%B8%80')
    .replace(/\n/g, '\r\n');
  expect(filterVodAdSegments(input).playlist).toBe(input);
});

it('maps history/seeks across multiple removed ranges and clamps resumes inside an ad to the next programme segment', () => {
  const ranges = [
    { start: 10, end: 20 },
    { start: 30, end: 35 },
  ];
  expect(sourceToFilteredTime(ranges, 5)).toBe(5);
  expect(sourceToFilteredTime(ranges, 15)).toBe(10);
  expect(sourceToFilteredTime(ranges, 27)).toBe(17);
  expect(sourceToFilteredTime(ranges, 37)).toBe(22);
  expect(filteredToSourceTime(ranges, 10)).toBe(20);
  expect(filteredToSourceTime(ranges, 22)).toBe(37);
  for (const time of [0, 5, 20, 25, 35, 37, 100])
    expect(
      filteredToSourceTime(ranges, sourceToFilteredTime(ranges, time))
    ).toBe(time);
});
