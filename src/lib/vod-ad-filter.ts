import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  PlaylistLoaderContext,
} from 'hls.js';

export interface VodAdRange {
  start: number;
  end: number;
}

// Confirmed in Fengbao/Baofeng VOD playlists. Match the URI path, never
// a query-string substring or a generic discontinuity between normal scenes.
function isKnownAd(uri: string, playlistUrl: string) {
  try {
    const base = new URL(playlistUrl);
    const url = new URL(uri, base);
    return (
      /^https?:$/.test(url.protocol) &&
      url.origin === base.origin &&
      /^\/video\/adjump\/time\/[\w-]+\.ts$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function markVodAds(playlist: string, playlistUrl: string) {
  const ranges: VodAdRange[] = [];
  // Never apply finite VOD timestamps to a sliding live window or a master.
  if (
    !/^#EXTM3U\s*$/m.test(playlist) ||
    !/^#EXT-X-ENDLIST\s*$/m.test(playlist) ||
    /^#EXT-X-STREAM-INF:/m.test(playlist)
  )
    return { playlist, ranges };

  const lines = playlist.split('\n');
  const output: string[] = [];
  const gap = playlist.includes('\r\n') ? '#EXT-X-GAP\r' : '#EXT-X-GAP';
  let time = 0;
  let duration = 0;
  let hasGap = false;
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith('#EXTINF:')) {
      duration = Number(text.slice(8).split(',')[0]);
    } else if (text === '#EXT-X-GAP') {
      hasGap = true;
    } else if (text && !text.startsWith('#')) {
      if (!Number.isFinite(duration) || duration <= 0)
        return { playlist, ranges: [] as VodAdRange[] };
      if (isKnownAd(text, playlistUrl)) {
        if (!hasGap) output.push(gap);
        const previous = ranges[ranges.length - 1];
        if (previous && Math.abs(previous.end - time) < 0.001)
          previous.end = time + duration;
        else ranges.push({ start: time, end: time + duration });
      }
      time += duration;
      duration = 0;
      hasGap = false;
    }
    output.push(line);
  }
  // Keep URIs, sequence numbers, encryption IVs, byte ranges and all timeline
  // tags intact. GAP tells hls.js not to download these confirmed ad segments.
  return { playlist: ranges.length ? output.join('\n') : playlist, ranges };
}

export function skipVodAd(
  video: Pick<HTMLVideoElement, 'currentTime' | 'duration'>,
  ranges: readonly VodAdRange[]
) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
  const range = ranges.find(
    ({ start, end }) =>
      video.currentTime >= start - 0.05 && video.currentTime < end
  );
  if (!range) return false;
  const target = Math.min(range.end + 0.02, video.duration);
  if (target <= video.currentTime) return false;
  video.currentTime = target;
  return true;
}

export function vodAdPlaylistLoader(
  BaseLoader: HlsConfig['loader'],
  onRanges: (ranges: VodAdRange[]) => void
): NonNullable<HlsConfig['pLoader']> {
  return class extends BaseLoader {
    declare context: PlaylistLoaderContext | null;

    load(
      context: PlaylistLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<PlaylistLoaderContext>
    ) {
      super.load(context, config, {
        onSuccess: (response, stats, _current, network) => {
          if (
            (context.type === 'manifest' || context.type === 'level') &&
            typeof response.data === 'string'
          ) {
            const marked = markVodAds(
              response.data,
              response.url || context.url
            );
            onRanges(marked.ranges);
            callbacks.onSuccess(
              { ...response, data: marked.playlist },
              stats,
              context,
              network
            );
          } else callbacks.onSuccess(response, stats, context, network);
        },
        onError: (error, _current, network, stats) =>
          callbacks.onError(error, context, network, stats),
        onTimeout: (stats, _current, network) =>
          callbacks.onTimeout(stats, context, network),
        onAbort: (stats, _current, network) =>
          callbacks.onAbort?.(stats, context, network),
        onProgress: callbacks.onProgress
          ? (stats, _current, data, network) =>
              callbacks.onProgress?.(stats, context, data, network)
          : undefined,
      });
    }
  };
}
