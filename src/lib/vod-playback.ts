import Hls from 'hls.js';

import { vodAdLoader } from './vod-ad-filter';

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
    // Restore the original player's manifest/level filtering loader.
    loader: blockAds
      ? vodAdLoader(Hls.DefaultConfig.loader)
      : Hls.DefaultConfig.loader,
  });
  video.hls = hls;
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}
