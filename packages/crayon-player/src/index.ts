import Artplayer from 'artplayer';
import Hls from 'hls.js';

import { createCrayonPlayerCore } from './core';
import { createMediaPreparer, mediaPreparationNotice,MediaPreparer } from './media-client';
import { EnhancementOptions } from './plugin';
import { attachVodHls, vodFilteredTime, vodSourceDuration, vodSourceTime } from './vod-playback';
import { sourceToFilteredTime } from './vod-segment-filter';

export type { CastOptions, CastSource, PreparedCastSource } from './casting';
export { attachCasting, prepareCastSdk } from './casting';
export type { CrayonPlayerCoreOptions } from './core';
export type { CrayonPlayerCoreOptions as PlayerOptions } from './core';
export { createCrayonPlayerCore } from './core';
export type { GestureOptions } from './gestures';
export { attachGestures } from './gestures';
export type { MediaPreparer, PreparedMedia } from './media-client';
export { createMediaPreparer, MediaPreparationError, mediaPreparationNotice } from './media-client';
export type { EnhancementOptions } from './plugin';
export { crayonPlayerPlugin } from './plugin';
export { filterAdsFromM3U8, vodAdLoader } from './vod-ad-filter';
export { attachVodHls, vodFilteredTime, vodSourceDuration, vodSourceTime } from './vod-playback';
export type { VodAdFilterResult, VodAdRange } from './vod-segment-filter';
export { filterVodAdSegments } from './vod-segment-filter';

type ArtOptions = ConstructorParameters<typeof Artplayer>[0];
export interface CrayonPlayerOptions {
  container: string | HTMLDivElement;
  url: string;
  title?: string;
  poster?: string;
  autoplay?: boolean;
  blockAds?: boolean;
  /** Scope this key to a film/episode, not to the whole site. */
  storageKey?: string;
  skip?: { enabled?: boolean; intro?: number; outro?: number };
  onNext?: () => void;
  onProgress?: (sourceTime: number, sourceDuration: number) => void;
  enhancements?: EnhancementOptions;
  /** Advanced playback settings; supplied container and URL remain authoritative. */
  player?: Partial<ArtOptions>;
  /** @deprecated Use player instead. */
  artplayer?: Partial<ArtOptions>;
  prepareMedia?: string | MediaPreparer;
}

/** Standalone VOD player. Host applications can also install just crayonPlayerPlugin. */
export function createCrayonPlayer(options: CrayonPlayerOptions): Artplayer {
  // eslint-disable-next-line prefer-const -- Callbacks are declared before construction and close over this binding.
  let art: Artplayer;
  let destroyed = false;
  let blocked = options.blockAds !== false;
  const prepareMedia = typeof options.prepareMedia === 'string' ? createMediaPreparer(options.prepareMedia) : options.prepareMedia;
  const playerOptions = { ...options.artplayer, ...options.player };
  let resume: number | undefined;
  let lastSave = 0;
  let advanced = false;
  let wake: { release(): Promise<void> } | undefined;
  let wakePending = false;
  let recoveryCount = 0;
  const skip = { enabled: false, intro: 0, outro: 0, ...options.skip };
  try {
    const saved = options.storageKey && localStorage.getItem(options.storageKey);
    if (saved) {
      const record = JSON.parse(saved);
      if (record.url === options.url && Number.isFinite(record.time) && record.time >= 0) resume = record.time;
    }
  } catch { /* Storage is optional in private browsing. */ }
  const sourceUrl = () => art?.option.url || options.url;
  const hlsType = (video: HTMLVideoElement, url: string) => {
    // attachVodHls owns both the engine and its native/AirPlay alternative.
    const hls = attachVodHls(video, url, () => {
      queueMicrotask(() => { if (!destroyed) art.notice.show = '此浏览器不支持 HLS 播放'; });
    }, blocked,
      result => {
        const seconds = result.removed.reduce((sum, range) => sum + range.end - range.start, 0);
        art.setting.update({ name: 'blockAds', tooltip: seconds ? `已过滤 ${seconds.toFixed(1)} 秒` : result.reason === 'unsupported' ? '已开启 · 当前格式暂不支持过滤' : '已开启 · 未识别出可过滤广告' });
      },
      prepareMedia ? url => prepareMedia(url,blocked) : undefined,
      (error, fallback) => { art.notice.show = mediaPreparationNotice(error, fallback); });
    hls?.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || destroyed) return;
      if (++recoveryCount > 3) { hls.destroy(); art.notice.show = '视频加载失败，请检查片源后重试'; return; }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else { hls.destroy(); art.notice.show = '视频加载失败，请更换片源'; }
    });
    hls?.on(Hls.Events.FRAG_LOADED, () => { recoveryCount = 0; });
  };
  const next = () => {
    if (advanced) return;
    advanced = true;
    if (options.onNext) options.onNext();
    else art.pause();
  };
  art = createCrayonPlayerCore({
    poster: options.poster || '', autoplay: options.autoplay ?? false, volume: 0.7,
    pip: true, setting: true, playbackRate: true, fullscreen: true,
    fullscreenWeb: true, airplay: true, playsInline: true, lock: true,
    autoOrientation: true, theme: '#22c55e', lang: 'zh-cn',
    ...playerOptions,
    container: options.container, url: options.url, id: playerOptions.id || 'crayon-player',
    customType: { m3u8: hlsType, ...playerOptions.customType },
    settings: [
      { name: 'blockAds', html: '去广告', tooltip: blocked ? '已开启' : '已关闭', onClick() {
        if (!Hls.isSupported() && !prepareMedia) return '原生播放需要配置去广告服务';
        resume = vodSourceTime(art.video);
        blocked = !blocked;
        recoveryCount = 0;
        hlsType(art.video, sourceUrl());
        return blocked ? '已开启' : '已关闭';
      } },
      { html: '跳过片头片尾', switch: skip.enabled, onSwitch: item => (skip.enabled = !item.switch) },
      { html: '设置片头', onClick() { skip.intro = vodSourceTime(art.video); return `${Math.floor(skip.intro)} 秒`; } },
      { html: '设置片尾', onClick() { skip.outro = Math.max(0, vodSourceDuration(art.video) - vodSourceTime(art.video)); return `${Math.floor(skip.outro)} 秒`; } },
      { html: '删除跳过配置', onClick() { skip.enabled = false; skip.intro = 0; skip.outro = 0; return '已清除'; } },
      ...(playerOptions.settings || []),
    ],
    controls: [
      ...(options.onNext ? [{ name: 'nextEpisode', html: '下一集', position: 'left' as const, index: 13, click: next }] : []),
      ...(playerOptions.controls || []),
    ],
  }, {
    ...options.enhancements,
    casting: options.enhancements?.casting === false ? false : {
      getSource: () => ({ url: sourceUrl(), title: art.title, currentTime: vodSourceTime(art.video) }),
      ...(prepareMedia ? { prepareSource: async (source: { url: string; title?: string }) => {
        const prepared = await prepareMedia(source.url,blocked);
        return { ...source,...prepared, mapTime: (time: number) => sourceToFilteredTime(prepared.filter.removed,time) };
      } } : {}),
      ...options.enhancements?.casting,
    },
  });
  function save() {
    if (destroyed || !Number.isFinite(art.currentTime)) return;
    const time = vodSourceTime(art.video);
    const duration = vodSourceDuration(art.video);
    try { if (options.storageKey) localStorage.setItem(options.storageKey, JSON.stringify({ url: sourceUrl(), time })); } catch { /* optional */ }
    options.onProgress?.(time, duration);
  }
  async function releaseWake() {
    const lock = wake;
    wake = undefined;
    try { await lock?.release(); } catch { /* already released */ }
  }
  async function acquireWake() {
    if (wake || wakePending || destroyed || !art.playing || document.hidden) return;
    const navigatorWithWake = navigator as Navigator & { wakeLock?: { request(type: string): Promise<{ release(): Promise<void>; addEventListener(type: string, callback: () => void): void }> } };
    if (!navigatorWithWake.wakeLock) return;
    wakePending = true;
    try {
      const lock = await navigatorWithWake.wakeLock.request('screen');
      if (destroyed || !art.playing || document.hidden) { await lock.release(); return; }
      wake = lock;
      lock.addEventListener('release', () => { if (wake === lock) wake = undefined; });
    } catch { /* Permission or platform may deny screen wake lock. */ }
    finally { wakePending = false; }
  }
  const visibility = () => { if (document.hidden) { save(); void releaseWake(); } else void acquireWake(); };
  art.on('video:canplay', () => {
    if (resume !== undefined) {
      art.currentTime = Math.min(vodFilteredTime(art.video, resume), Math.max(0, art.duration - 1));
      resume = undefined;
    }
  });
  art.on('video:timeupdate', () => {
    if (Date.now() - lastSave > 5000) { save(); lastSave = Date.now(); }
    if (!skip.enabled) return;
    const time = vodSourceTime(art.video);
    const duration = vodSourceDuration(art.video);
    if (skip.intro > 0 && time < skip.intro && skip.intro < duration) art.seek = vodFilteredTime(art.video, skip.intro);
    if (skip.outro > 0 && duration > 0 && time >= duration - skip.outro) next();
  });
  art.on('video:ended', () => { save(); void releaseWake(); next(); });
  art.on('play', () => { void acquireWake(); });
  art.on('pause', () => { save(); void releaseWake(); });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', save);
  art.on('destroy', () => {
    save();
    destroyed = true;
    delete art.video.vodNativeRequest;
    void releaseWake();
    art.video.hls?.destroy();
    delete art.video.hls;
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', save);
  });
  art.title = options.title || '';
  return art;
}
