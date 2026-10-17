import type {
  LevelLoadedData,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';
import Hls from 'hls.js';

import { attachVodHls } from './vod-playback';

let video: HTMLVideoElement;
let unsupported: jest.Mock;

beforeEach(() => {
  video = document.createElement('video');
  unsupported = jest.fn();
  jest.spyOn(Hls, 'isSupported').mockReturnValue(true);
  // jsdom has no MediaSource; keep the real HLS playlist parser and loaders.
  jest.spyOn(Hls.prototype, 'attachMedia').mockImplementation(() => undefined);
});

afterEach(() => {
  video.hls?.destroy();
  jest.restoreAllMocks();
  localStorage.clear();
});

function playFixture(playlist: string, blockAds = true) {
  let parsed: LevelLoadedData | undefined;
  const loadSource = Hls.prototype.loadSource;
  jest
    .spyOn(Hls.prototype, 'loadSource')
    .mockImplementation(function (this: Hls, url) {
      this.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        parsed = data;
      });
      // Run the real playlist loader/parser, replacing only HTTP transport.
      const prototype = this.config.loader.prototype as Loader<LoaderContext>;
      const load = jest
        .spyOn(prototype, 'load')
        .mockImplementation(function (
          this: InstanceType<typeof Hls.DefaultConfig.loader>,
          context: LoaderContext,
          _config: LoaderConfiguration,
          callbacks: LoaderCallbacks<LoaderContext>
        ) {
          callbacks.onSuccess(
            { url: context.url, data: playlist },
            this.stats,
            context,
            null
          );
        });
      try {
        loadSource.call(this, url);
      } finally {
        load.mockRestore();
      }
    });
  const hls = attachVodHls(
    video,
    'https://media.test/movie.m3u8',
    unsupported,
    blockAds
  );
  return { hls, parsed };
}

it.each([true, false])(
  'preserves normal timestamp boundaries with ad blocking set to %s',
  (blockAds) => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-DISCONTINUITY-SEQUENCE:7',
      '#EXTINF:6,',
      'first.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6,',
      'second.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6,',
      'third.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const { hls, parsed } = playFixture(playlist, blockAds);
    expect(hls).toBe(video.hls);
    expect(parsed?.details.fragments.map((fragment) => fragment.cc)).toEqual([
      7, 8, 9,
    ]);
    expect(parsed?.details.totalduration).toBe(18);
    expect(parsed?.details.live).toBe(false);
    expect(unsupported).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  'keeps encrypted segment numbering and cleans up ad seeks with blocking set to %s',
  (blockAds) => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:20',
      '#EXT-X-DISCONTINUITY-SEQUENCE:7',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:6,',
      'before.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:3,',
      '/video/adjump/time/ad0.ts',
      '#EXTINF:2.04,',
      '/video/adjump/time/ad1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:6,',
      'after.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const { hls, parsed } = playFixture(playlist, blockAds);
    const fragments = parsed?.details.fragments || [];
    expect(fragments.map((fragment) => fragment.sn)).toEqual([20, 21, 22, 23]);
    expect(fragments.map((fragment) => fragment.cc)).toEqual([7, 8, 8, 9]);
    expect(fragments.map((fragment) => !!fragment.gap)).toEqual([
      false,
      blockAds,
      blockAds,
      false,
    ]);
    expect(fragments[3].decryptdata?.iv?.[15]).toBe(23);
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 17.04,
    });
    video.currentTime = 7;
    video.dispatchEvent(new Event('seeking'));
    expect(video.currentTime).toBeCloseTo(blockAds ? 11.06 : 7);
    hls?.destroy();
    video.currentTime = 7;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(7);
  }
);

it('releases the previous episode before loading and attaching the next one', () => {
  jest.spyOn(Hls.prototype, 'loadSource').mockImplementation(() => undefined);
  const first = attachVodHls(video, 'https://media.test/1.m3u8', unsupported);
  if (!first) throw new Error('Expected an HLS instance');
  const destroy = jest.spyOn(first, 'destroy');
  const second = attachVodHls(video, 'https://media.test/2.m3u8', unsupported);
  if (!second) throw new Error('Expected an HLS instance');
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(video.hls).toBe(second);
  expect(second).not.toBe(first);
  expect(Hls.prototype.loadSource).toHaveBeenLastCalledWith(
    'https://media.test/2.m3u8'
  );
  expect(Hls.prototype.attachMedia).toHaveBeenLastCalledWith(video);
  expect(second.config.lowLatencyMode).toBe(false);
  expect(second.config.maxBufferLength).toBeGreaterThan(30);
  expect(second.config.maxMaxBufferLength).toBeLessThanOrEqual(120);
  expect(second.config.backBufferLength).toBeLessThanOrEqual(30);
});

it('falls back to native HLS on Safari without constructing an unsupported engine', () => {
  jest.spyOn(Hls, 'isSupported').mockReturnValue(false);
  jest.spyOn(video, 'canPlayType').mockReturnValue('maybe');
  expect(
    attachVodHls(video, 'https://media.test/movie.m3u8', unsupported)
  ).toBeNull();
  expect(video.src).toBe('https://media.test/movie.m3u8');
  expect(video.hls).toBeUndefined();
  expect(Hls.prototype.attachMedia).not.toHaveBeenCalled();
  expect(unsupported).not.toHaveBeenCalled();
});

it('reports a browser with neither MSE nor native HLS support', () => {
  jest.spyOn(Hls, 'isSupported').mockReturnValue(false);
  jest.spyOn(video, 'canPlayType').mockReturnValue('');
  expect(
    attachVodHls(video, 'https://media.test/movie.m3u8', unsupported)
  ).toBeNull();
  expect(unsupported).toHaveBeenCalledTimes(1);
  expect(video.hls).toBeUndefined();
  expect(video.hasAttribute('src')).toBe(false);
});
