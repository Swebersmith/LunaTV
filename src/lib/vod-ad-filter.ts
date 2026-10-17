import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  PlaylistLoaderContext,
} from 'hls.js';

import { analyzeVodAds, VodAdRange } from './vod-ad-detection';
import { rewriteVodAds } from './vod-ad-rewrite';

export type { VodAdRange } from './vod-ad-detection';

export function markVodAds(
  playlist: string,
  playlistUrl: string,
  sharedTimeline = false
) {
  const ranges: VodAdRange[] = [];
  // Never apply finite VOD timestamps to a sliding live window or a master.
  if (
    !/^#EXTM3U\s*$/m.test(playlist) ||
    !/^#EXT-X-ENDLIST\s*$/m.test(playlist) ||
    /^#EXT-X-STREAM-INF:/m.test(playlist) ||
    /^#EXT-X-(?:PART:|SKIP:|I-FRAMES-ONLY)/m.test(playlist)
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
  // Independently clocked audio/subtitle renditions cannot be shortened safely
  // without matching segment boundaries across every rendition.
  if (sharedTimeline) analysis.ranges = [];
  const rewritten = rewriteVodAds(lines, analysis);
  return rewritten
    ? { playlist: rewritten.lines.join('\n'), ranges: rewritten.ranges }
    : { playlist, ranges };
}

export function vodAdPlaylistLoader(
  BaseLoader: HlsConfig['loader'],
  onRanges: (ranges: VodAdRange[]) => void
): NonNullable<HlsConfig['pLoader']> {
  let sharedTimeline = false;
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
            if (context.type === 'manifest')
              sharedTimeline = response.data
                .split('\n')
                .some(
                  (line) =>
                    /^#EXT-X-MEDIA:/.test(line) &&
                    /(?:^|,)TYPE=(?:AUDIO|SUBTITLES)(?:,|$)/.test(
                      line.slice(13)
                    ) &&
                    /(?:^|,)URI="/.test(line.slice(13))
                );
            const marked = markVodAds(
              response.data,
              response.url || context.url,
              sharedTimeline
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
