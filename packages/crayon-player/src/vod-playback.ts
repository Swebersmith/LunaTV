import Hls from 'hls.js';

import { configureInlineVideo } from './inline-video';
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
    /** Preparation blocks local playback until a filtered source or loader is ready. */
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
  configureInlineVideo(video);
  video.hls?.destroy();
  delete video.hls;
  delete video.vodAdFilter;
  delete video.vodPlaybackUrl;
  // Clear the previous episode or explicit casting source before preparation.
  const hadSource = video.hasAttribute('src') || !!video.querySelector('source');
  video.removeAttribute('src');
  video.querySelectorAll('source').forEach(source => source.remove());
  if (hadSource) video.load();
  const request = {};
  video.vodNativeRequest = request;
  video.vodNativePending = false;
  const mse = Hls.isSupported();
  // Local HLS always stays in Crayon's MSE/MMS player. A native HLS capability
  // must never switch the phone to a different playback path or system UI.
  if (!mse) {
    delete video.vodNativeRequest;
    onUnsupported();
    return null;
  }
  // MMS can open without an HTTP alternative when remote playback is disabled.
  // Only an explicit cast action installs a TV source and enables it again.
  video.disableRemotePlayback = true;
  const preparedPlayback = blockAds && !!prepareSource;
  const browserLoader = () => vodAdLoader(Hls.DefaultConfig.loader, result => {
    if (video.hls !== hls) return;
    video.vodAdFilter = result;
    onAdFilter?.(result);
  });
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
    loader: blockAds && !preparedPlayback
      ? browserLoader()
      : Hls.DefaultConfig.loader,
  });
  video.hls = hls;
  hls.on(Hls.Events.DESTROYING, () => {
    if (video.hls === hls) delete video.hls;
    if (video.vodNativeRequest === request) {
      delete video.vodNativeRequest;
      video.vodNativePending = false;
    }
  });
  const load = (playbackUrl: string, filter?: VodAdFilterResult) => {
    if (video.vodNativeRequest !== request || video.hls !== hls) return;
    video.vodNativePending = false;
    video.vodPlaybackUrl = playbackUrl;
    if (filter) video.vodAdFilter = filter;
    hls.loadSource(playbackUrl);
    hls.attachMedia(video);
    if (filter) onAdFilter?.(filter);
  };
  if (preparedPlayback && prepareSource) {
    video.vodNativePending = true;
    const failed = (error: unknown) => {
      if (video.vodNativeRequest !== request) return;
      video.vodNativePending = false;
      // MSE can still filter the actual playlist in-browser when the relay
      // cannot reach this provider. Never add a raw native/AirPlay alternative.
      const fallback = !(error instanceof MediaPreparationError) || error.browserFallback;
      if (fallback) {
        hls.config.loader = browserLoader();
        load(url);
      }
      // TVs still require a prepared HTTP playlist from an explicit cast action.
      onPreparationError?.(error, fallback);
    };
    try {
      void prepareSource(url).then(prepared => load(prepared.url, prepared.filter)).catch(failed);
    } catch (error) { failed(error); }
  } else load(url);
  return hls;
}

/** Bound fatal recovery instead of leaving the player in an endless load loop. */
export function attachVodRecovery(hls: Hls, onFailure: () => void) {
  let attempts = 0;
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    if (++attempts <= 3 && data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
    else if (attempts <= 3 && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else { hls.destroy(); onFailure(); }
  });
  hls.on(Hls.Events.FRAG_LOADED, () => { attempts = 0; });
}

/** Explicit casting only. Preserve the MMS blob while installing a TV URL. */
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
