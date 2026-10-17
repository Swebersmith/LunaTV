import { markVodAds } from './vod-ad-filter';
import { toVodContentTime, toVodSourceTime } from './vod-ad-rewrite';

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

it('removes exactly nine ad segments and joins every normal segment on a shorter timeline', () => {
  const original = playlist();
  const marked = markVodAds(original, url);
  expect(marked.ranges).toHaveLength(1);
  expect(marked.ranges[0].start).toBeCloseTo(301.88);
  expect(marked.ranges[0].end).toBeCloseTo(327.92);
  expect(marked.playlist).not.toContain('#EXT-X-GAP');
  expect(marked.playlist).not.toContain('/video/adjump/');
  expect(marked.playlist.match(/^#EXTINF:/gm)).toHaveLength(52);
  expect(marked.playlist).toContain(
    'before.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:6,\nafter.ts'
  );
  expect(marked.playlist.match(/^#EXT-X-DISCONTINUITY$/gm)).toHaveLength(1);
  expect(markVodAds(marked.playlist, url)).toEqual({
    playlist: marked.playlist,
    ranges: [],
  });
});

it('preserves CRLF and init maps while making the original AES sequence IV explicit', () => {
  const original = playlist()
    .replace(
      '#EXTINF:1.88,',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-BYTERANGE:1024@0\n#EXTINF:1.88,'
    )
    .replace(/\n/g, '\r\n');
  const marked = markVodAds(original, url);
  expect(marked.ranges).toHaveLength(1);
  expect(marked.playlist).toContain('#EXT-X-MEDIA-SEQUENCE:20\r\n');
  expect(marked.playlist).toContain('#EXT-X-MAP:URI="init.mp4"\r\n');
  expect(marked.playlist).toContain('#EXT-X-BYTERANGE:1024@0\r\n');
  expect(marked.playlist).toContain(
    'IV=0x00000000000000000000000000000050\r\nafter.ts'
  );
  expect(marked.playlist.replace(/\r\n/g, '')).not.toContain('\n');
});

it('leaves ordinary discontinuities, unknown paths, query parameters and CDN switches alone', () => {
  const original = playlist().replace(
    /\/video\/adjump\/time\/ad\d+\.ts/g,
    'https://other.test/program/scene.ts'
  );
  expect(markVodAds(original, url)).toEqual({ playlist: original, ranges: [] });
  for (const replacement of [
    'main-ad.ts',
    'main.ts?next=/video/adjump/time/ad.ts',
    '/downloads/scene.ts',
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

it('maps history and toggle positions without moving past any normal program frame', () => {
  const { ranges } = markVodAds(playlist(), url);
  expect(toVodContentTime(303, ranges)).toBeCloseTo(301.88);
  expect(toVodContentTime(328.92, ranges)).toBeCloseTo(302.88);
  expect(toVodSourceTime(302.88, ranges)).toBeCloseTo(328.92);
  expect(toVodSourceTime(301.88, ranges)).toBeCloseTo(327.92);
  expect(toVodContentTime(100, ranges)).toBe(100);
  expect(toVodSourceTime(100, ranges)).toBe(100);
});

it('merges adjacent ad segments but preserves normal video between two ad breaks', () => {
  const original = playlist().replace(
    '#EXT-X-ENDLIST',
    '#EXTINF:3,\n/video/adjump/time/tail.ts\n#EXTINF:3,\nend.ts\n#EXT-X-ENDLIST'
  );
  const { ranges } = markVodAds(original, url);
  expect(ranges).toHaveLength(2);
  expect(ranges[1].start - ranges[0].end).toBeCloseTo(6);
  for (const time of [0, 100, 302, 307, 310]) {
    expect(toVodContentTime(toVodSourceTime(time, ranges), ranges)).toBeCloseTo(
      time
    );
  }
});

it('makes an implicit byte offset explicit after removing a range from the same media file', () => {
  const original =
    '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n#EXT-X-BYTERANGE:100@0\nall.ts\n#EXT-X-CUE-OUT:6\n#EXTINF:6,\n#EXT-X-BYTERANGE:200\nall.ts\n#EXT-X-CUE-IN\n#EXTINF:6,\n#EXT-X-BYTERANGE:300\nall.ts\n#EXT-X-ENDLIST\n';
  const filtered = markVodAds(original, url);
  expect(filtered.ranges).toEqual([{ start: 6, end: 12 }]);
  expect(filtered.playlist).toContain('#EXT-X-BYTERANGE:300@300');
  expect(filtered.playlist).not.toContain('#EXT-X-BYTERANGE:200');
  expect(filtered.playlist).toContain(
    '#EXT-X-DISCONTINUITY\n#EXTINF:6,\n#EXT-X-BYTERANGE:300@300'
  );
  expect(markVodAds(filtered.playlist, url).playlist).toBe(filtered.playlist);
});

it('preserves the source rather than guessing an invalid implicit byte offset or unsupported IV', () => {
  for (const tag of [
    '#EXT-X-BYTERANGE:300',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"',
  ]) {
    const original = playlist().replace(
      '#EXTINF:1.88,',
      tag + '\n#EXTINF:1.88,'
    );
    expect(markVodAds(original, url)).toEqual({
      playlist: original,
      ranges: [],
    });
  }
});

it.each([15, -3])(
  'maps EXT-X-START offsets to the shortened timeline: %s',
  (offset) => {
    const original = `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-START:TIME-OFFSET=${offset},PRECISE=YES\n#EXTINF:6,\nbefore.ts\n#EXT-X-CUE-OUT:6\n#EXTINF:6,\nad.ts\n#EXT-X-CUE-IN\n#EXTINF:6,\nafter.ts\n#EXT-X-ENDLIST\n`;
    expect(markVodAds(original, url).playlist).toContain(
      `TIME-OFFSET=${offset < 0 ? -3 : 9},PRECISE=YES`
    );
  }
);

it('leaves independently clocked audio and subtitles on the source timeline', () => {
  const original = playlist();
  expect(markVodAds(original, url, true)).toEqual({
    playlist: original,
    ranges: [],
  });
});
