import type Artplayer from 'artplayer';

export interface CastOptions {
  /** Always return the original HTTP(S) media URL, never the HLS blob URL. */
  getSource: () => { url: string; title?: string; type?: string; currentTime?: number };
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
  const api = window as unknown as CastApi;
  const castEnabled = options.chromecast !== false;
  if (castEnabled) void prepareCastSdk();
  const panel = document.createElement('div');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '投屏方式');
  panel.hidden = true;
  panel.style.cssText = 'position:absolute;right:12px;bottom:54px;z-index:100;padding:12px;max-width:calc(100% - 24px);border-radius:12px;background:rgba(16,24,20,.97);color:white;box-shadow:0 8px 32px #0008;font:14px/1.5 sans-serif';
  const hint = document.createElement('p');
  hint.textContent = '设备需在同一网络；电视需能直接访问原片源。投屏端不应用本地分片去广告。';
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
    const source = options.getSource();
    let url: URL;
    try {
      url = new URL(source.url, document.baseURI);
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
      const type = source.type || (/\.m3u8(?:[?#]|$)/i.test(url.href) ? 'application/x-mpegURL' : 'video/mp4');
      const media = new chrome.media.MediaInfo(url.href, type);
      const metadata = new chrome.media.GenericMediaMetadata();
      metadata.title = source.title || art.title || 'Crayon Player';
      media.metadata = metadata;
      const request = new chrome.media.LoadRequest(media);
      request.currentTime = Math.max(0, source.currentTime ?? art.currentTime);
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
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) native.focus();
  };
  art.controls.add({ name: 'crayonCast', position: 'right', index: 18, html: trigger, tooltip: '投屏' });
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); } };
  const outside = (event: Event) => { if (!panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
  const sourceChanged = () => { generation++; close(); };
  document.addEventListener('keydown', escape);
  document.addEventListener('click', outside);
  video.addEventListener('loadstart', sourceChanged);
  return () => {
    disposed = true;
    generation++;
    document.removeEventListener('keydown', escape);
    document.removeEventListener('click', outside);
    video.removeEventListener('loadstart', sourceChanged);
    panel.remove();
    art.controls.remove('crayonCast');
  };
}
