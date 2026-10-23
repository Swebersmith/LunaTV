import Hls from 'hls.js';

import { vodAdLoader } from './vod-ad-filter';
import {
  filteredToSourceTime,
  sourceToFilteredTime,
  VodAdFilterResult,
} from './vod-segment-filter';

declare global {
  interface HTMLVideoElement {
    hls?: Hls;
    vodAdFilter?: VodAdFilterResult;
    vodNativeRequest?: object;
    vodNativePending?: boolean;
  }
}

export function attachVodHls(
  video: HTMLVideoElement,
  url: string,
  onUnsupported: () => void,
  blockAds = true,
  onAdFilter?: (result: VodAdFilterResult) => void,
  prepareNative?: (url: string) => Promise<{ url: string; filter: VodAdFilterResult }>,
  onNativeError?: () => void
): Hls | null {
  video.hls?.destroy();
  delete video.hls;
  delete video.vodAdFilter;
  const nativeRequest = {};
  video.vodNativeRequest = nativeRequest;
  video.vodNativePending = false;

  if (!Hls.isSupported()) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      if (blockAds && prepareNative) {
        video.vodNativePending = true;
        void prepareNative(url).then(prepared => {
          if (video.vodNativeRequest !== nativeRequest) return;
          video.vodNativePending = false;
          video.vodAdFilter = prepared.filter;
          video.querySelectorAll('source').forEach(source => { source.src = prepared.url; });
          video.src = prepared.url;
          onAdFilter?.(prepared.filter);
        }).catch(() => {
          if (video.vodNativeRequest === nativeRequest) { video.vodNativePending = false; onNativeError?.(); }
        });
      } else video.src = url;
    }
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
    // Filter actual ad segment groups while preserving retained HLS state.
    loader: blockAds
      ? vodAdLoader(Hls.DefaultConfig.loader, (result) => {
          if (video.hls !== hls) return;
          video.vodAdFilter = result;
          onAdFilter?.(result);
        })
      : Hls.DefaultConfig.loader,
  });
  video.hls = hls;
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}

export function vodSourceTime(
  video: HTMLVideoElement | undefined,
  time = video?.currentTime || 0
): number {
  return filteredToSourceTime(video?.vodAdFilter?.removed || [], time);
}

export function vodFilteredTime(
  video: HTMLVideoElement | undefined,
  time: number
): number {
  return sourceToFilteredTime(video?.vodAdFilter?.removed || [], time);
}

export function vodSourceDuration(
  video: HTMLVideoElement | undefined,
  duration = video?.duration || 0
): number {
  return video?.vodAdFilter?.originalDuration || duration;
}
