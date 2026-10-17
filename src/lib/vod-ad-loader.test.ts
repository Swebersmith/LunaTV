import type {
  Loader,
  LoaderCallbacks,
  LoaderContext,
  PlaylistLoaderContext,
} from 'hls.js';
import Hls from 'hls.js';

import { vodAdPlaylistLoader } from './vod-ad-filter';

it.each(['manifest', 'level', 'audioTrack', 'subtitleTrack'])(
  'filters %s without letting alternate tracks overwrite the primary ad clock',
  (type) => {
    const playlist =
      '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nbefore.ts\n#EXT-X-CUE-OUT:6\n#EXTINF:6,\nopaque.ts\n#EXT-X-CUE-IN\n#EXTINF:6,\nafter.ts\n#EXT-X-ENDLIST\n';
    const prototype = Hls.DefaultConfig.loader
      .prototype as Loader<LoaderContext>;
    const onRanges = jest.fn();
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
          null
        );
      });
    const PlaylistLoader = vodAdPlaylistLoader(
      Hls.DefaultConfig.loader,
      onRanges
    );
    const loader = new PlaylistLoader(Hls.DefaultConfig);
    const context: PlaylistLoaderContext = {
      type: type as PlaylistLoaderContext['type'],
      url: 'https://provider.test/media.m3u8',
      responseType: 'text',
      level: 0,
      id: 0,
      deliveryDirectives: null,
      levelOrTrack: null,
    };
    const callbacks: LoaderCallbacks<PlaylistLoaderContext> = {
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
      const response = jest.mocked(callbacks.onSuccess).mock.calls[0][0];
      expect(
        typeof response.data === 'string' &&
          response.data.includes('#EXT-X-GAP')
      ).toBe(type !== 'subtitleTrack');
      expect(onRanges).toHaveBeenCalledTimes(
        type === 'manifest' || type === 'level' ? 1 : 0
      );
      expect(jest.mocked(callbacks.onSuccess).mock.calls[0][2]).toBe(context);
    } finally {
      loader.destroy();
      load.mockRestore();
    }
  }
);
