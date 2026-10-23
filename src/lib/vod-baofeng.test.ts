import { readFileSync } from 'fs';
import type { Loader, LoaderContext } from 'hls.js';
import Hls from 'hls.js';
import { join } from 'path';

import { filterVodAdSegments } from './vod-segment-filter';

// Captured from the public Baofeng API's movie/series playlists, 2026-10-23.
// Retain real variable programme cadences and both repeated 9-fragment inserts.
it.each([
  ['movie.m3u8', 1649],
  ['series.m3u8', 680],
  ['new-series.m3u8', 1303],
] as const)(
  'removes both Baofeng ad groups without removing programme fragments: %s',
  (file, retainedCount) => {
    const original = readFileSync(
      join(__dirname, '__fixtures__/baofeng', file),
      'utf8'
    );
    const result = filterVodAdSegments(
      original,
      'https://source.example/video/episode/index.m3u8'
    );
    expect(result.reason).toBe('filtered');
    expect(result.removed).toHaveLength(2);
    result.removed.forEach((range) =>
      expect(range.end - range.start).toBeCloseTo(26.04)
    );
    expect(result.playlist).not.toContain('/video/adjump/time/');
    const beforeUris = original
      .split(/\r?\n/)
      .filter(
        (line) =>
          line &&
          !line.startsWith('#') &&
          !line.startsWith('/video/adjump/time/')
      );
    const afterUris = result.playlist
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'));
    expect(afterUris).toEqual(beforeUris);
    expect(afterUris).toHaveLength(retainedCount);
  }
);

it('requires a whole bounded discontinuity group of explicit ad paths', () => {
  const input = readFileSync(
    join(__dirname, '__fixtures__/baofeng/series.m3u8'),
    'utf8'
  );
  const withoutMarker = input.replaceAll(
    '/video/adjump/time/',
    '/video/adjump/timeless/'
  );
  expect(filterVodAdSegments(withoutMarker).playlist).toBe(withoutMarker);
  const mixed = input.replaceAll(
    '/video/adjump/time/17873198659330000000.ts',
    'programme-scene.ts'
  );
  expect(filterVodAdSegments(mixed).playlist).toBe(mixed);
});

it('handles absolute, signed and percent-encoded ad paths without damaging source parameters', () => {
  const input = readFileSync(
    join(__dirname, '__fixtures__/baofeng/series.m3u8'),
    'utf8'
  );
  const signed = input
    .replaceAll(
      '/video/adjump/time/',
      'https://media.example/video/adjump/%74ime/'
    )
    .replaceAll('.ts', '.ts?token=a%2Fb&x=1');
  const result = filterVodAdSegments(signed);
  expect(result.removed).toHaveLength(2);
  expect(result.playlist).not.toContain('178731986593');
  expect(result.playlist).toContain('0000000.ts?token=a%2Fb&x=1');
});

it('lets hls.js parse the real filtered Baofeng playlist and preserves seek positions after both inserts', () => {
  const original = readFileSync(
    join(__dirname, '__fixtures__/baofeng/series.m3u8'),
    'utf8'
  );
  const filtered = filterVodAdSegments(original);
  const hls = new Hls();
  let duration = 0;
  const prototype = Hls.DefaultConfig.loader.prototype as Loader<LoaderContext>;
  const load = jest
    .spyOn(prototype, 'load')
    .mockImplementation(function (
      this: InstanceType<typeof Hls.DefaultConfig.loader>,
      context,
      _config,
      callbacks
    ) {
      callbacks.onSuccess(
        { url: context.url, data: filtered.playlist },
        this.stats,
        context,
        null
      );
    });
  hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
    duration = data.details.totalduration;
  });
  try {
    hls.loadSource('https://source.example/video/episode/index.m3u8');
    expect(duration).toBeCloseTo(filtered.originalDuration - 52.08);
  } finally {
    hls.destroy();
    load.mockRestore();
  }
});
