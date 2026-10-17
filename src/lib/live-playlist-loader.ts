import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  PlaylistLoaderContext,
} from 'hls.js';

interface Window {
  sequence: number;
  end: number;
  target: number;
  at: number;
  rejected: number;
}

export class LivePlaylistGuard {
  private windows = new Map<string, Window>();

  check(url: string, data: unknown, now = Date.now()) {
    if (typeof data !== 'string' || /#EXT-X-ENDLIST(?:\s|$)/.test(data))
      return 'accept';
    const sequence = Number(
      /^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m.exec(data)?.[1]
    );
    const target = Number(
      /^#EXT-X-TARGETDURATION:([\d.]+)\s*$/m.exec(data)?.[1]
    );
    const durations = Array.from(
      data.matchAll(/^#EXTINF:([\d.]+)/gm),
      (match) => Number(match[1])
    ).filter((duration) => Number.isFinite(duration) && duration > 0);
    const count = durations.length;
    if (!Number.isSafeInteger(sequence) || !count || !(target > 0))
      return 'accept';
    const previous = this.windows.get(url);
    const end = sequence + count - 1;
    const fastest = durations.reduce(
      (minimum, duration) => Math.min(minimum, duration),
      target
    );
    if (previous) {
      // A stale load-balancer replica can return an unrelated sequence window
      // without a discontinuity tag. Never merge that window into buffered PTS.
      const elapsed = Math.max(0, now - previous.at) / 1000;
      const allowedAdvance = Math.max(
        100,
        Math.ceil(elapsed / Math.min(fastest, previous.target)) + count
      );
      if (end < previous.sequence || sequence > previous.end + allowedAdvance) {
        previous.rejected++;
        return previous.rejected >= 3 ? 'restart' : 'retry';
      }
    }
    if (!previous && this.windows.size >= 16) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
    this.windows.set(url, {
      sequence,
      end,
      target: fastest,
      at: now,
      rejected: 0,
    });
    return 'accept';
  }
}

export function livePlaylistLoader(
  BaseLoader: HlsConfig['loader'],
  onRestart: () => void
): NonNullable<HlsConfig['pLoader']> {
  // Per player, shared between its manifest and successive playlist loaders.
  // Only window metadata: no retained playlist bodies, video data or writes.
  const guard = new LivePlaylistGuard();
  let restarting = false;
  return class extends BaseLoader {
    declare context: PlaylistLoaderContext | null;

    load(
      context: PlaylistLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<PlaylistLoaderContext>
    ) {
      super.load(context, config, {
        onSuccess: (response, stats, _current, network) => {
          const decision = guard.check(context.url, response.data);
          if (decision !== 'accept') {
            if (decision === 'restart' && !restarting) {
              restarting = true;
              onRestart();
            }
            callbacks.onError(
              { code: 0, text: '直播源播放列表的时间轴异常' },
              context,
              network,
              stats
            );
            return;
          }
          callbacks.onSuccess(response, stats, context, network);
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
