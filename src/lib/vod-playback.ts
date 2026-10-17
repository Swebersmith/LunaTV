import Hls from 'hls.js';

import { vodAdPlaylistLoader, VodAdRange } from './vod-ad-filter';
import { toVodContentTime, toVodSourceTime } from './vod-ad-rewrite';

const timelines = new WeakMap<HTMLVideoElement, VodAdRange[]>();

export function vodSourceTime(video: HTMLVideoElement, time: number) {
  return toVodSourceTime(time, timelines.get(video) || []);
}

export function vodContentTime(video: HTMLVideoElement, time: number) {
  return toVodContentTime(time, timelines.get(video) || []);
}

declare global {
  interface HTMLVideoElement {
    hls?: Hls;
  }
}

export function attachVodHls(
  video: HTMLVideoElement,
  url: string,
  onUnsupported: () => void,
  blockAds = true
): Hls | null {
  video.hls?.destroy();
  delete video.hls;
  timelines.delete(video);

  if (!Hls.isSupported()) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
    else onUnsupported();
    return null;
  }

  const hls = new Hls({
    debug: false,
    enableWorker: true,
    lowLatencyMode: false,
    // VOD can download ahead instead of staying close to a live edge.
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    backBufferLength: 30,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.3,
    enableInterstitialPlayback: !blockAds,
    // Join retained segments on a shortened timeline; no currentTime ad jumps.
    ...(blockAds && {
      pLoader: vodAdPlaylistLoader(Hls.DefaultConfig.loader, (ranges) => {
        timelines.set(video, ranges);
      }),
    }),
  });
  hls.on(Hls.Events.DESTROYING, () => timelines.delete(video));
  video.hls = hls;
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}
