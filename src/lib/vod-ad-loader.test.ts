import type { Loader, LoaderCallbacks, LoaderContext } from 'hls.js';
import Hls from 'hls.js';

import { vodAdLoader } from './vod-ad-filter';

it.each(['manifest', 'level', 'audioTrack', 'subtitleTrack'])(
  'uses the original filtering scope for %s requests',
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
      const filtered = type === 'manifest' || type === 'level';
      expect(String(call[0].data).includes('#EXT-X-DISCONTINUITY')).toBe(
        !filtered
      );
      expect(call[0].data).toContain('/video/adjump/time/ad.ts');
      expect(call[0].data).toContain('#EXT-X-MEDIA-SEQUENCE:20');
      expect(call[0].data).toContain('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"');
      expect(call[2]).toBe(context);
      expect(call[3]).toBe(filtered ? null : network);
      if (!filtered) expect(call[0].data).toBe(playlist);
    } finally {
      loader.destroy();
      load.mockRestore();
    }
  }
);
