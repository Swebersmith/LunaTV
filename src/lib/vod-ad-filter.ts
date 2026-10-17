import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  PlaylistLoaderContext,
} from 'hls.js';

import { analyzeVodAds, VodAdRange } from './vod-ad-detection';

export type { VodAdRange } from './vod-ad-detection';

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
  let parsed: ReturnType<typeof analyzeVodAds>;
  try {
    parsed = analyzeVodAds(lines, playlistUrl);
  } catch {
    return { playlist, ranges };
  }
  const analysis = parsed;
  if (!analysis) return { playlist, ranges };
  const output: string[] = [];
  const gap = playlist.includes('\r\n') ? '#EXT-X-GAP\r' : '#EXT-X-GAP';
  const gapLines = new Set(
    analysis.segments
      .filter(
        (segment) =>
          !segment.hasGap &&
          analysis.ranges.some(
            (range) =>
              segment.start >= range.start - 0.001 &&
              segment.end <= range.end + 0.001
          )
      )
      .map((segment) => segment.line)
  );
  for (let index = 0; index < lines.length; index++) {
    if (analysis.removeLines.has(index)) continue;
    if (gapLines.has(index)) output.push(gap);
    output.push(lines[index]);
  }
  // Keep URIs, sequence numbers, encryption IVs, byte ranges and all timeline
  // tags intact. GAP tells hls.js not to download these confirmed ad segments.
  return {
    playlist:
      gapLines.size || analysis.removeLines.size ? output.join('\n') : playlist,
    ranges: analysis.ranges,
  };
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
            (context.type === 'manifest' ||
              context.type === 'level' ||
              context.type === 'audioTrack') &&
            typeof response.data === 'string'
          ) {
            const marked = markVodAds(
              response.data,
              response.url || context.url
            );
            if (context.type !== 'audioTrack') onRanges(marked.ranges);
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
