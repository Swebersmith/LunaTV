import type { HlsConfig } from 'hls.js';

export function liveHlsConfig(): Partial<HlsConfig> {
  const retry = { maxNumRetry: 2, retryDelayMs: 500, maxRetryDelayMs: 2000 };
  const playlist = {
    maxTimeToFirstByteMs: 15000,
    maxLoadTimeMs: 20000,
    timeoutRetry: { ...retry },
    errorRetry: { ...retry },
  };
  return {
    enableWorker: true,
    lowLatencyMode: false,
    // Leave a safety margin at the live edge instead of chasing new fragments.
    // hls.js clamps this to the actual window for short three-fragment lists.
    liveSyncDurationCount: 4,
    liveSyncOnStallIncrease: 2,
    startOnSegmentBoundary: true,
    maxBufferLength: 40,
    maxMaxBufferLength: 60,
    backBufferLength: 15,
    maxBufferSize: 40 * 1000 * 1000,
    maxBufferHole: 0.3,
    capLevelToPlayerSize: true,
    capLevelOnFPSDrop: true,
    manifestLoadPolicy: { default: { ...playlist } },
    playlistLoadPolicy: { default: { ...playlist } },
    fragLoadPolicy: {
      default: {
        // IP-based origins can take over ten seconds to produce a fragment.
        // Avoid aborting useful downloads and throwing away their progress.
        maxTimeToFirstByteMs: 20000,
        maxLoadTimeMs: 45000,
        timeoutRetry: { ...retry },
        errorRetry: { ...retry },
      },
    },
  };
}

export function liveBufferAhead(
  video: Pick<HTMLVideoElement, 'buffered' | 'currentTime'>
) {
  const { buffered, currentTime } = video;
  for (let index = 0; index < buffered.length; index++) {
    if (
      currentTime >= buffered.start(index) - 0.05 &&
      currentTime < buffered.end(index)
    )
      return buffered.end(index) - currentTime;
  }
  return 0;
}

export function liveStartupBuffer(
  details?: {
    live: boolean;
    targetduration: number;
    totalduration: number;
  } | null
) {
  if (!details?.live) return 0;
  // Respect short playlists: requiring more than the window could deadlock.
  return Math.max(
    0,
    Math.min(
      10,
      details.targetduration * 2,
      details.totalduration - details.targetduration
    )
  );
}
