import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  PlaylistLoaderContext,
} from 'hls.js';

import { filterVodAdSegments, VodAdFilterResult } from './vod-segment-filter';

export function filterAdsFromM3U8(m3u8Content: string, url?: string): string {
  return filterVodAdSegments(m3u8Content, url).playlist;
}

export function vodAdLoader(
  BaseLoader: HlsConfig['loader'],
  onFiltered?: (result: VodAdFilterResult) => void
): HlsConfig['loader'] {
  // Main/audio/subtitle playlists need coordinated cuts. Keep all renditions
  // intact when a master uses external tracks rather than desynchronizing them.
  let externalTracks = false;
  return class extends BaseLoader {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ) {
      const type = (context as PlaylistLoaderContext).type;
      if (type === 'manifest' || type === 'level') {
        const onSuccess = callbacks.onSuccess;
        callbacks = {
          ...callbacks,
          onSuccess(response, stats, current, networkDetails) {
            if (typeof response.data === 'string') {
              const content = response.data;
              if (type === 'manifest')
                externalTracks = content
                  .split(/\r?\n/)
                  .some(
                    (line) =>
                      line.startsWith('#EXT-X-MEDIA:') &&
                      /TYPE=(?:AUDIO|SUBTITLES)(?:,|$)/.test(line) &&
                      /URI=/.test(line)
                  );
              const result = externalTracks
                ? {
                    playlist: content,
                    originalDuration: 0,
                    removed: [],
                    reason: 'unsupported' as const,
                  }
                : filterVodAdSegments(content, response.url || current.url);
              response.data = result.playlist;
              if (!content.includes('#EXT-X-STREAM-INF:')) onFiltered?.(result);
            }
            return onSuccess(response, stats, current, networkDetails);
          },
        };
      }
      super.load(context, config, callbacks);
    }
  };
}
