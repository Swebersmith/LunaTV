import type Artplayer from 'artplayer';
import type { VodAdFilterResult } from './vod-segment-filter';

export interface CastSource { url: string; title?: string; type?: string; currentTime?: number }
export interface PreparedCastSource extends CastSource {
  filter?: VodAdFilterResult;
  mapTime?: (sourceTime: number) => number;
}

export interface CastOptions {
  /** Always return the original HTTP(S) media URL, never the HLS blob URL. */
  getSource: () => CastSource;
  /** Prepare a TV-accessible filtered playlist before the user opens the device picker. */
  prepareSource?: (source: CastSource) => Promise<PreparedCastSource>;
  chromecast?: boolean;
}

type CastSession = {
  loadMedia(request: unknown): Promise<void>;
};
interface CastApi {
  cast?: { framework?: { CastContext: { getInstance(): {
    setOptions(options: unknown): void;
    requestSession(): Promise<void>;
    getCurrentSession(): CastSession | null;
  } } } };
  chrome?: { cast?: {
    AutoJoinPolicy: { ORIGIN_SCOPED: string };
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      MediaInfo: new (url: string, type: string) => { metadata?: unknown };
      GenericMediaMetadata: new () => { title?: string };
      LoadRequest: new (info: unknown) => { currentTime?: number; autoplay?: boolean };
    };
  } };
}
type CastVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  remote?: EventTarget & { state: string; prompt(): Promise<void> };
};

let sdkPromise: Promise<boolean> | undefined;
export function prepareCastSdk(): Promise<boolean> {
  const api = window as unknown as CastApi;
  if (api.cast?.framework && api.chrome?.cast) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;
  // Preload before the user clicks; requestSession must retain user activation.
  sdkPromise = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      const available = !!(api.cast?.framework && api.chrome?.cast);
      if (!available) { script.remove(); sdkPromise = undefined; }
      resolve(available);
    };
    const timeout = setTimeout(finish, 12000);
    const poll = setInterval(() => { if (api.cast?.framework && api.chrome?.cast) finish(); }, 100);
    script.onerror = finish;
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function attachCasting(art: Artplayer, options: CastOptions) {
  const video = art.video as CastVideo;
  let disposed = false;
  let busy = false;
  let generation = 0;
  let prepared: { original: string; value: PreparedCastSource } | undefined;
  let preparing: Promise<void> | undefined;
  const nativeRestores = new Set<() => void>();
  const warm = () => {
    if (!options.prepareSource || disposed || preparing) return;
    const original = options.getSource();
    if (prepared?.original === original.url) return;
    const stamp = generation;
    preparing = options.prepareSource(original).then(value => {
      if (!disposed && stamp === generation && options.getSource().url === original.url) prepared = { original: original.url, value };
    }).catch(() => { /* The picker reports a preparation failure only on demand. */ }).finally(() => { preparing = undefined; });
  };
  const readySource = () => {
    const original = options.getSource();
    if (!options.prepareSource) return { original, media: original as PreparedCastSource };
    if (prepared?.original === original.url) return { original, media: prepared.value };
    warm();
    art.notice.show = '正在准备投屏清单，请稍后再点击投屏方式';
    return null;
  };
  const api = window as unknown as CastApi;
  const castEnabled = options.chromecast !== false;
  if (castEnabled) void prepareCastSdk();
  const panel = document.createElement('div');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '投屏方式');
  panel.hidden = true;
  panel.style.cssText = 'position:absolute;right:12px;bottom:54px;z-index:100;padding:12px;max-width:calc(100% - 24px);border-radius:12px;background:rgba(16,24,20,.97);color:white;box-shadow:0 8px 32px #0008;font:14px/1.5 sans-serif';
  const hint = document.createElement('p');
  hint.textContent = options.prepareSource
    ? '设备需在同一网络；去广告开关也用于投屏，识别结果取决于片源。'
    : '设备需在同一网络；电视需能直接访问片源。';
  hint.style.cssText = 'max-width:280px;margin:0 0 8px;color:#ccc;font-size:12px';
  panel.appendChild(hint);
  const button = (text: string, action: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.style.cssText = 'display:block;width:100%;margin:6px 0;padding:10px;border:1px solid #fff3;border-radius:8px;background:#ffffff12;color:white;text-align:left;cursor:pointer';
    el.onclick = action;
    panel.appendChild(el);
    return el;
  };
  const report = (error: unknown) => {
    const code = (error as { name?: string; code?: string })?.code;
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'AbortError' || code === 'cancel') return;
    art.notice.show = '投屏未连接，请检查同一网络、浏览器支持及电视对片源的访问权限';
  };
  const native = button('AirPlay / 系统投屏', () => {
    // Call synchronously from the real click; no await before opening the picker.
    try {
      const source = readySource();
      if (!source) return;
      if (options.prepareSource && video.src !== source.media.url) {
        const hls = /mpegurl/i.test(source.media.type || '') || /\.m3u8(?:[?#]|$)/i.test(source.media.url);
        if (hls && !video.canPlayType('application/vnd.apple.mpegurl')) {
          art.notice.show = '此浏览器请使用 Chromecast 投屏以保留清单去广告'; return;
        }
        const time = source.media.mapTime?.(source.original.currentTime ?? art.currentTime) ?? source.original.currentTime ?? art.currentTime;
        video.hls?.destroy(); delete video.hls;
        video.vodAdFilter = source.media.filter;
        video.querySelectorAll('source').forEach(item => { item.src = source.media.url; });
        video.src = source.media.url;
        const restore = () => {
          nativeRestores.delete(restore);
          if (!disposed && video.src === source.media.url) art.currentTime = Math.max(0, time);
        };
        nativeRestores.add(restore);
        video.addEventListener('loadedmetadata',restore,{once:true});
      }
      if (video.webkitShowPlaybackTargetPicker) video.webkitShowPlaybackTargetPicker();
      else if (video.remote?.prompt) void video.remote.prompt().catch(report);
      else art.notice.show = '此浏览器未提供系统投屏，请使用 Safari 或支持投屏的 Chrome';
    } catch (error) { report(error); }
  });
  let castButton: HTMLButtonElement | undefined;
  if (castEnabled) castButton = button('Chromecast / Google Cast', () => {
    if (busy) return;
    const framework = api.cast?.framework;
    const chrome = api.chrome?.cast;
    if (!framework || !chrome) {
      art.notice.show = 'Google Cast 正在准备或网络不可达，请稍后再试';
      void prepareCastSdk();
      return;
    }
    const ready = readySource();
    if (!ready) return;
    const source = ready.original;
    const mediaSource = ready.media;
    let url: URL;
    try {
      url = new URL(mediaSource.url, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) throw new Error('Unsupported URL');
    } catch { art.notice.show = '投屏需要可由电视访问的 HTTP(S) 视频地址'; return; }
    const context = framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    const stamp = generation;
    busy = true;
    castButton!.disabled = true;
    // requestSession is invoked in the click stack, preserving user activation.
    void context.requestSession().then(async () => {
      if (disposed || stamp !== generation || options.getSource().url !== source.url) return;
      const session = context.getCurrentSession();
      if (!session) throw new Error('No cast session');
      const type = mediaSource.type || source.type || (/\.m3u8(?:[?#]|$)/i.test(url.href) ? 'application/x-mpegURL' : 'video/mp4');
      const media = new chrome.media.MediaInfo(url.href, type);
      const metadata = new chrome.media.GenericMediaMetadata();
      metadata.title = source.title || art.title || 'Crayon Player';
      media.metadata = metadata;
      const request = new chrome.media.LoadRequest(media);
      const originalTime = options.getSource().currentTime ?? source.currentTime ?? art.currentTime;
      request.currentTime = Math.max(0, mediaSource.mapTime?.(originalTime) ?? mediaSource.currentTime ?? originalTime);
      request.autoplay = true;
      await session.loadMedia(request);
      if (disposed || stamp !== generation || options.getSource().url !== source.url) return;
      art.pause();
      art.notice.show = '已发送到电视；请使用 Google Cast 控制界面控制和停止投屏';
      close();
    }).catch(error => { if (!disposed) report(error); }).finally(() => {
      busy = false;
      if (castButton) castButton.disabled = false;
    });
  });
  button('关闭', () => close());
  art.template.$player.appendChild(panel);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', '投屏');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.style.cssText = 'background:transparent;color:inherit;border:0;cursor:pointer;padding:6px;display:flex;align-items:center';
  trigger.innerHTML = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M2 12a10 10 0 0 1 10 10M2 17a5 5 0 0 1 5 5"/><circle cx="2" cy="22" r="1"/></svg>';
  function close() { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  trigger.onclick = () => {
    warm();
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) native.focus();
  };
  art.controls.add({ name: 'crayonCast', position: 'right', index: 18, html: trigger, tooltip: '投屏' });
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); } };
  const outside = (event: Event) => { if (!panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
  const sourceChanged = () => { generation++; prepared = undefined; close(); };
  const control = (visible: boolean) => { if (!visible) close(); };
  document.addEventListener('keydown', escape);
  document.addEventListener('click', outside);
  video.addEventListener('loadstart', sourceChanged);
  art.on('control', control);
  art.on('video:canplay', warm);
  return () => {
    disposed = true;
    nativeRestores.forEach(restore => video.removeEventListener('loadedmetadata',restore));
    nativeRestores.clear();
    generation++;
    document.removeEventListener('keydown', escape);
    document.removeEventListener('click', outside);
    video.removeEventListener('loadstart', sourceChanged);
    art.off('control', control);
    art.off('video:canplay', warm);
    panel.remove();
    art.controls.remove('crayonCast');
  };
}
