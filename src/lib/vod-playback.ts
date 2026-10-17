import Hls from 'hls.js';

import { skipVodAd, vodAdPlaylistLoader, VodAdRange } from './vod-ad-filter';

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

  let adRanges: VodAdRange[] = [];
  const skipAd = () => skipVodAd(video, adRanges);
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
    // Preserve timeline boundaries while filtering ad markers and segment groups.
    ...(blockAds && {
      pLoader: vodAdPlaylistLoader(Hls.DefaultConfig.loader, (ranges) => {
        adRanges = ranges;
        skipAd();
      }),
    }),
  });
  if (blockAds) {
    const events = [
      'timeupdate',
      'seeking',
      'waiting',
      'playing',
      'loadedmetadata',
    ];
    events.forEach((event) => video.addEventListener(event, skipAd));
    hls.on(Hls.Events.DESTROYING, () => {
      adRanges = [];
      events.forEach((event) => video.removeEventListener(event, skipAd));
    });
  }
  video.hls = hls;
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}
