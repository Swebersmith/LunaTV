import type { Loader, LoaderCallbacks, LoaderContext } from 'hls.js';
import Hls from 'hls.js';

import { vodAdLoader } from './vod-ad-filter';

it.each(['manifest', 'level', 'audioTrack', 'subtitleTrack'])(
  'does not strip valid discontinuities from an ambiguous short %s playlist',
  (type) => {
    const playlist =
      '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:20\n#EXT-X-DISCONTINUITY-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nbefore.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:3,\n/video/adjump/time/ad.ts\n#EXTINF:6,\nafter.ts\n#EXT-X-ENDLIST\n';
    const prototype = Hls.DefaultConfig.loader
      .prototype as Loader<LoaderContext>;
    const network = { source: 'transport' };
    const load = jest
      .spyOn(prototype, 'load')
      .mockImplementation(function (
        this: Loader<LoaderContext>,
        context,
        _config,
        callbacks
      ) {
        callbacks.onSuccess(
          { url: context.url, data: playlist },
          this.stats,
          context,
          network
        );
      });
    const OriginalLoader = vodAdLoader(Hls.DefaultConfig.loader);
    const loader = new OriginalLoader(Hls.DefaultConfig);
    const context = {
      type,
      url: 'https://provider.test/media.m3u8',
      responseType: 'text' as const,
    };
    const callbacks: LoaderCallbacks<LoaderContext> = {
      onSuccess: jest.fn(),
      onError: jest.fn(),
      onTimeout: jest.fn(),
    };
    try {
      loader.load(
        context,
        {
          loadPolicy: Hls.DefaultConfig.playlistLoadPolicy.default,
          maxRetry: 0,
          timeout: 1000,
          retryDelay: 0,
          maxRetryDelay: 0,
        },
        callbacks
      );
      const call = jest.mocked(callbacks.onSuccess).mock.calls[0];
      expect(String(call[0].data).includes('#EXT-X-DISCONTINUITY')).toBe(true);
      expect(call[0].data).toContain('/video/adjump/time/ad.ts');
      expect(call[0].data).toContain('#EXT-X-MEDIA-SEQUENCE:20');
      expect(call[0].data).toContain('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"');
      expect(call[2]).toBe(context);
      expect(call[3]).toBe(network);
      expect(call[0].data).toBe(playlist);
    } finally {
      loader.destroy();
      load.mockRestore();
    }
  }
);

it('filters main playlists while retaining transport metadata and passes external audio renditions through', () => {
  const program = Array.from(
    { length: 24 },
    (_, i) => `#EXTINF:6.006,\n/v/movie-${i}.ts`
  ).join('\n');
  const ad =
    Array.from({ length: 6 }, (_, i) => `#EXTINF:2,\n/v/insert-${i}.ts`).join(
      '\n'
    ) + '\n#EXTINF:0.5,\n/v/insert-last.ts';
  const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:7\n${program}\n#EXT-X-DISCONTINUITY\n${ad}\n#EXT-X-DISCONTINUITY\n${program}\n#EXT-X-ENDLIST\n`;
  let payload = playlist;
  const network = { transport: true };
  const onFiltered = jest.fn();
  const LoaderClass = vodAdLoader(Hls.DefaultConfig.loader, onFiltered);
  const prototype = Hls.DefaultConfig.loader.prototype as Loader<LoaderContext>;
  const load = jest
    .spyOn(prototype, 'load')
    .mockImplementation(function (
      this: Loader<LoaderContext>,
      context,
      _config,
      callbacks
    ) {
      callbacks.onSuccess(
        { url: context.url, data: payload },
        this.stats,
        context,
        network
      );
    });
  const request = (type: string) => {
    const loader = new LoaderClass(Hls.DefaultConfig);
    const success = jest.fn();
    loader.load(
      {
        type,
        url: 'https://provider.test/video.m3u8',
        responseType: 'text',
      } as LoaderContext,
      {
        loadPolicy: Hls.DefaultConfig.playlistLoadPolicy.default,
        maxRetry: 0,
        timeout: 1000,
        retryDelay: 0,
        maxRetryDelay: 0,
      },
      { onSuccess: success, onError: jest.fn(), onTimeout: jest.fn() }
    );
    loader.destroy();
    return success.mock.calls[0];
  };
  try {
    expect(request('manifest')[0].data).not.toContain('insert-');
    expect(onFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'filtered' })
    );
    expect(request('level')[3]).toBe(network);
    expect(request('audioTrack')[0].data).toBe(playlist);
    expect(request('subtitleTrack')[0].data).toBe(playlist);
    payload =
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=123456,AUDIO="a"\nvideo.m3u8\n';
    request('manifest');
    payload = playlist;
    expect(request('level')[0].data).toBe(playlist);
    expect(onFiltered).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'unsupported' })
    );
  } finally {
    load.mockRestore();
  }
});
