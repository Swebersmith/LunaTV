import Hls from 'hls.js';

import { MediaPreparationError } from './media-client';
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
    /** Preparation blocks every playback path, including MSE and native alternatives. */
    vodNativePending?: boolean;
    vodPlaybackUrl?: string;
  }
}

export function attachVodHls(
  video: HTMLVideoElement,
  url: string,
  onUnsupported: () => void,
  blockAds = true,
  onAdFilter?: (result: VodAdFilterResult) => void,
  prepareSource?: (url: string) => Promise<{ url: string; filter: VodAdFilterResult }>,
  onPreparationError?: (error: unknown, browserFallback: boolean) => void
): Hls | null {
  video.hls?.destroy();
  delete video.hls;
  delete video.vodAdFilter;
  delete video.vodPlaybackUrl;
  // Remove the previous native source and its buffered media before async preparation.
  const hadSource = video.hasAttribute('src') || !!video.querySelector('source');
  video.removeAttribute('src');
  video.querySelectorAll('source').forEach(source => source.remove());
  if (hadSource) video.load();
  const request = {};
  video.vodNativeRequest = request;
  video.vodNativePending = false;
  const mse = Hls.isSupported();
  const native = !!video.canPlayType('application/vnd.apple.mpegurl');
  // iPad may support BOTH MSE/MMS and native HLS. A prepared HTTP playlist is
  // already filtered, so native playback can use it without a second JS engine.
  const useNative = native && (!mse || !!prepareSource);
  if (!mse && !native) {
    onUnsupported();
    return null;
  }
  const preparedPlayback = blockAds && !!prepareSource;
  const browserLoader = () => vodAdLoader(Hls.DefaultConfig.loader, result => {
    if (video.hls !== hls) return;
    video.vodAdFilter = result;
    onAdFilter?.(result);
  });
  const hls: Hls | null = useNative ? null : new Hls({
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
    loader: blockAds && !preparedPlayback
      ? browserLoader()
      : Hls.DefaultConfig.loader,
  });
  if (hls) {
    video.hls = hls;
    hls.on(Hls.Events.DESTROYING, () => {
      if (video.hls === hls) delete video.hls;
      if (video.vodNativeRequest === request) {
        delete video.vodNativeRequest;
        video.vodNativePending = false;
      }
    });
  }
  const load = (playbackUrl: string, filter?: VodAdFilterResult, browserFallback = false) => {
    if (video.vodNativeRequest !== request || hls && video.hls !== hls) return;
    video.vodNativePending = false;
    video.vodPlaybackUrl = playbackUrl;
    if (filter) video.vodAdFilter = filter;
    if (hls) {
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      // A raw fallback would bypass client-side filtering in standalone mode.
      if (!browserFallback && (preparedPlayback || !blockAds)) setHlsAlternative(video, playbackUrl);
    } else {
      setHlsAlternative(video, playbackUrl);
      video.src = playbackUrl;
    }
    if (filter) onAdFilter?.(filter);
  };
  if (preparedPlayback && prepareSource) {
    video.vodNativePending = true;
    const failed = (error: unknown) => {
      if (video.vodNativeRequest !== request) return;
      video.vodNativePending = false;
      // MSE can still filter the actual playlist in-browser when the relay
      // cannot reach this provider. Never add a raw native/AirPlay alternative.
      const fallback = !!hls && (!(error instanceof MediaPreparationError) || error.browserFallback);
      if (fallback && hls) {
        hls.config.loader = browserLoader();
        load(url, undefined, true);
      }
      // Native playback and TVs still require a prepared HTTP playlist.
      onPreparationError?.(error, fallback);
    };
    try {
      void prepareSource(url).then(prepared => load(prepared.url, prepared.filter)).catch(failed);
    } catch (error) { failed(error); }
  } else load(url);
  return hls;
}

/** Keep HLS.js's MMS blob source; only replace the HTTP alternative. */
export function setHlsAlternative(video: HTMLVideoElement, url: string) {
  video.querySelectorAll('source').forEach(source => {
    if (!source.src.startsWith('blob:')) source.remove();
  });
  const source = document.createElement('source');
  source.src = url;
  source.type = 'application/vnd.apple.mpegurl';
  video.appendChild(source);
  video.disableRemotePlayback = false;
  video.removeAttribute('disableRemotePlayback');
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
