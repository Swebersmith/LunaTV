import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  PlaylistLoaderContext,
} from 'hls.js';

// Keep the original player's filtering behavior, including sequence markers.
export function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';
  const lines = m3u8Content.split('\n');
  const filteredLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('#EXT-X-DISCONTINUITY'))
      filteredLines.push(lines[i]);
  }
  return filteredLines.join('\n');
}

export function vodAdLoader(
  BaseLoader: HlsConfig['loader']
): HlsConfig['loader'] {
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
          onSuccess(response, stats, current) {
            if (response.data && typeof response.data === 'string')
              response.data = filterAdsFromM3U8(response.data);
            return onSuccess(response, stats, current, null);
          },
        };
      }
      super.load(context, config, callbacks);
    }
  };
}
