import { markVodAds } from './vod-ad-filter';

const base = 'https://program.test/episode/index.m3u8';
const segment = (uri: string, duration = 6) => `#EXTINF:${duration},\n${uri}`;
const normal = (prefix: string) =>
  Array.from({ length: 20 }, (_, index) =>
    segment(`${prefix}${index}.ts`)
  ).join('\n');
const vod = (...lines: string[]) =>
  [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    ...lines,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
const removedSegments = (original: string, filtered: string) =>
  (original.match(/^#EXTINF:/gm)?.length || 0) -
  (filtered.match(/^#EXTINF:/gm)?.length || 0);

it.each([
  '#EXT-X-CUE-OUT',
  '#EXT-X-CUE-OUT:6.000',
  '#EXT-X-CUE-OUT:DURATION=6',
])('recognizes provider-independent paired cue markers: %s', (cue) => {
  const original = vod(
    segment('before.ts'),
    cue,
    segment('opaque-one.ts', 3),
    '#EXT-X-CUE-OUT-CONT:ElapsedTime=3,Duration=6',
    segment('opaque-two.ts', 3),
    '#EXT-X-CUE-IN',
    segment('after.ts')
  );
  const marked = markVodAds(original, base);
  expect(marked.ranges).toEqual([{ start: 6, end: 12 }]);
  expect(removedSegments(original, marked.playlist)).toBe(2);
  expect(marked.playlist).toContain('before.ts');
  expect(marked.playlist).toContain('after.ts');
  expect(marked.playlist).not.toContain('opaque-');
});

it.each([
  '#EXT-X-CUE-OUT:0',
  '#EXT-X-CUE-OUT:DURATION=0',
  '#EXT-X-CUE-OUT:invalid',
])(
  'does not mistake an insertion-only or invalid cue for program replacement: %s',
  (cue) => {
    const original = vod(
      segment('before.ts'),
      cue,
      segment('scene.ts'),
      '#EXT-X-CUE-IN',
      segment('after.ts')
    );
    expect(markVodAds(original, base)).toEqual({
      playlist: original,
      ranges: [],
    });
  }
);

it('does not turn a missing or nested cue-in into an unbounded ad break', () => {
  const missing = vod(
    segment('before.ts'),
    '#EXT-X-CUE-OUT:6',
    segment('scene.ts'),
    segment('after.ts')
  );
  const nested = vod(
    '#EXT-X-CUE-OUT:6',
    segment('first.ts'),
    '#EXT-X-CUE-OUT:6',
    segment('second.ts'),
    '#EXT-X-CUE-IN'
  );
  for (const original of [missing, nested])
    expect(markVodAds(original, base)).toEqual({
      playlist: original,
      ranges: [],
    });
});

it.each([
  'DURATION=6,SCTE35-OUT=0xFC00',
  'END-DATE="2026-10-17T00:00:12Z",SCTE35-OUT=0xFC00',
  'DURATION=6,CLASS="com.example.ads"',
])(
  'maps completed DATERANGE metadata through the program clock: %s',
  (attrs) => {
    const original = vod(
      '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T00:00:00Z',
      `#EXT-X-DATERANGE:ID="break",START-DATE="2026-10-17T00:00:06Z",${attrs}`,
      segment('before.ts'),
      segment('opaque0.ts', 3),
      segment('opaque1.ts', 3),
      segment('after.ts')
    );
    const marked = markVodAds(original, base);
    expect(marked.ranges).toEqual([{ start: 6, end: 12 }]);
    expect(removedSegments(original, marked.playlist)).toBe(2);
  }
);

it('supports completed SCTE35 OUT/IN pairs without assuming a future start-date is the current frame', () => {
  const original = vod(
    segment('before.ts'),
    '#EXT-X-DATERANGE:ID="pair",START-DATE="2026-10-17T00:00:06Z",SCTE35-OUT=0xFC00',
    segment('opaque.ts'),
    '#EXT-X-DATERANGE:ID="pair",START-DATE="2026-10-17T00:00:06Z",SCTE35-IN=0xFC01',
    segment('after.ts')
  );
  expect(markVodAds(original, base).ranges).toEqual([{ start: 6, end: 12 }]);
});

it('keeps normal media in a segment that only partly overlaps a timed ad', () => {
  const original = vod(
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T00:00:00Z',
    '#EXT-X-DATERANGE:ID="partial",START-DATE="2026-10-17T00:00:02Z",DURATION=2,SCTE35-OUT=0xFC00',
    segment('shared.ts')
  );
  expect(markVodAds(original, base)).toEqual({
    playlist: original,
    ranges: [],
  });
});

it.each([
  'PLANNED-DURATION=6,SCTE35-OUT=0xFC00',
  'DURATION=6,SCTE35-CMD=0xFC00',
  'DURATION=6,CLASS="com.example.chapter"',
  'DURATION=6,CLASS="com.badger.scene"',
])('preserves ambiguous or non-ad DATERANGE metadata: %s', (attrs) => {
  const original = vod(
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T00:00:00Z',
    `#EXT-X-DATERANGE:ID="meta",START-DATE="2026-10-17T00:00:06Z",${attrs}`,
    segment('first.ts'),
    segment('second.ts'),
    segment('third.ts')
  );
  expect(markVodAds(original, base)).toEqual({
    playlist: original,
    ranges: [],
  });
});

it('leaves an unanchored future date or conflicting media clocks alone', () => {
  const tag =
    '#EXT-X-DATERANGE:ID="future",START-DATE="2026-10-17T00:00:06Z",DURATION=6,SCTE35-OUT=0xFC00';
  const unanchored = vod(tag, segment('first.ts'), segment('second.ts'));
  const conflicting = vod(
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T00:00:00Z',
    tag,
    segment('first.ts'),
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T01:00:00Z',
    segment('second.ts')
  );
  for (const original of [unanchored, conflicting])
    expect(markVodAds(original, base)).toEqual({
      playlist: original,
      ranges: [],
    });
});

it.each(['X-ASSET-URI', 'X-ASSET-LIST'])(
  'suppresses separately scheduled interstitial assets (%s) without skipping the primary program',
  (attribute) => {
    const first = `#EXT-X-DATERANGE:ID="insert",CLASS="com.apple.hls.interstitial",START-DATE="2026-10-17T00:00:06Z",DURATION=30,${attribute}="https://ads.test/list?a=1,b=2",X-RESUME-OFFSET=0`;
    const update =
      '#EXT-X-DATERANGE:ID="insert",END-DATE="2026-10-17T00:00:36Z"';
    const chapter =
      '#EXT-X-DATERANGE:ID="chapter",CLASS="chapter",START-DATE="2026-10-17T00:00:00Z",DURATION=12';
    const original = vod(
      first,
      chapter,
      segment('first.ts'),
      update,
      segment('second.ts')
    );
    const marked = markVodAds(original, base);
    expect(marked.ranges).toEqual([]);
    expect(removedSegments(original, marked.playlist)).toBe(0);
    expect(marked.playlist).toBe(
      original.replace(first + '\n', '').replace(update + '\n', '')
    );
    expect(marked.playlist).toContain(chapter);
  }
);

it('does not reinterpret a conflicting or malformed metadata record as an ad', () => {
  const original = vod(
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-17T00:00:00Z',
    '#EXT-X-DATERANGE:ID="bad",ID="duplicate",START-DATE="2026-10-17T00:00:00Z",DURATION=6,SCTE35-OUT=0x00',
    '#EXT-X-DATERANGE:ID="other",START-DATE="2026-10-17T00:00:00Z",DURATION=6,SCTE35-OUT=0x00',
    '#EXT-X-DATERANGE:ID="other",DURATION=12',
    segment('first.ts'),
    segment('second.ts')
  );
  expect(markVodAds(original, base)).toEqual({
    playlist: original,
    ranges: [],
  });
});

it.each([
  'ad',
  'ads',
  'advertisement',
  'preroll',
  'midroll',
  'postroll',
  'adbreak',
])(
  'recognizes a short spliced %s directory on another CDN, regardless of resource key',
  (directory) => {
    const original = vod(
      normal('before'),
      '#EXT-X-DISCONTINUITY',
      segment(`https://cdn-${directory}.test/${directory}/asset.ts`),
      '#EXT-X-DISCONTINUITY',
      normal('after')
    );
    const marked = markVodAds(
      original,
      `https://any-resource.test/${directory}/index.m3u8`
    );
    expect(marked.ranges).toEqual([{ start: 120, end: 126 }]);
    expect(removedSegments(original, marked.playlist)).toBe(1);
  }
);

it('does not use keywords, a CDN switch, or short duration alone to remove scenes', () => {
  for (const uri of [
    'https://other.test/scenes/scene.ts',
    'https://other.test/downloads/scene.ts',
    'https://other.test/adventures/scene.ts',
    'main-ad.ts',
    'scene.ts?redirect=/ads/asset.ts',
  ]) {
    const original = vod(
      normal('before'),
      '#EXT-X-DISCONTINUITY',
      segment(uri),
      '#EXT-X-DISCONTINUITY',
      normal('after')
    );
    expect(markVodAds(original, base)).toEqual({
      playlist: original,
      ranges: [],
    });
  }
  const mainInAdDirectory = vod(
    normal('https://content.test/ads/course/scene')
  );
  expect(markVodAds(mainInAdDirectory, base)).toEqual({
    playlist: mainInAdDirectory,
    ranges: [],
  });
});

it('recognizes repeated opaque ad islands only when both program runs return to the same directory', () => {
  const insert = [
    segment('https://cdn.test/opaque/9f0a.ts', 3),
    segment('https://cdn.test/opaque/c3d2.ts', 3),
  ].join('\n');
  const original = vod(
    normal('before'),
    '#EXT-X-DISCONTINUITY',
    insert,
    '#EXT-X-DISCONTINUITY',
    normal('middle'),
    '#EXT-X-DISCONTINUITY',
    insert,
    '#EXT-X-DISCONTINUITY',
    normal('after')
  );
  const marked = markVodAds(original, base);
  expect(marked.ranges).toEqual([
    { start: 120, end: 126 },
    { start: 246, end: 252 },
  ]);
  expect(removedSegments(original, marked.playlist)).toBe(4);
  expect(markVodAds(marked.playlist, base)).toEqual({
    playlist: marked.playlist,
    ranges: [],
  });
});

it.each([
  '#EXT-X-BYTERANGE:1024@0',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXT-X-MAP:URI="init.mp4"',
])('does not infer opaque repeats across stateful media: %s', (state) => {
  const insert = segment('https://cdn.test/opaque/same.ts');
  const original = vod(
    state,
    normal('before'),
    '#EXT-X-DISCONTINUITY',
    insert,
    '#EXT-X-DISCONTINUITY',
    normal('middle'),
    '#EXT-X-DISCONTINUITY',
    insert,
    '#EXT-X-DISCONTINUITY',
    normal('after')
  );
  expect(markVodAds(original, base)).toEqual({
    playlist: original,
    ranges: [],
  });
});

it('retains a single unknown inserted scene and long named-ad programs', () => {
  const single = vod(
    normal('before'),
    '#EXT-X-DISCONTINUITY',
    segment('https://cdn.test/opaque/scene.ts'),
    '#EXT-X-DISCONTINUITY',
    normal('after')
  );
  const long = vod(
    normal('before'),
    '#EXT-X-DISCONTINUITY',
    normal('https://cdn.test/ads/scene'),
    segment('https://cdn.test/ads/extra.ts'),
    '#EXT-X-DISCONTINUITY',
    normal('after')
  );
  for (const original of [single, long])
    expect(markVodAds(original, base)).toEqual({
      playlist: original,
      ranges: [],
    });
});
