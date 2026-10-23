import type Artplayer from 'artplayer';
import type { Setting } from 'artplayer/types/setting';

const MINI_KEY = 'crayon-player-mini-progress';
const SCRUB_EVENT = 'crayon-scrubbing';
const MINI_EVENT = 'crayon-mini-progress-change';
const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
const seekable = (art: Artplayer) => !art.option.isLive && Number.isFinite(art.duration) && art.duration > 0;

export function formatDuration(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours}小时` : ''}${hours || minutes ? `${minutes}分钟` : ''}${rest}秒`;
}

function miniPreference(fallback = false) {
  try {
    const saved = localStorage.getItem(MINI_KEY);
    if (saved !== null) return saved === '1';
  } catch { /* Browser storage is optional. */ }
  return fallback;
}

export function miniProgressSetting(fallback = false): Setting {
  return {
    name: 'crayonMiniProgress', html: '迷你进度条', tooltip: '隐藏控制栏时显示',
    switch: miniPreference(fallback),
    onSwitch(item) {
      const enabled = !item.switch;
      try { localStorage.setItem(MINI_KEY, enabled ? '1' : '0'); } catch { /* optional */ }
      this.template.$player.dispatchEvent(new CustomEvent(MINI_EVENT, { detail: enabled }));
      return enabled;
    },
  };
}

export function setScrubbing(art: Artplayer, active: boolean) {
  if (active) {
    art.template.$player.dataset.crayonScrubbing = 'true';
    art.controls.show = true;
  } else {
    delete art.template.$player.dataset.crayonScrubbing;
  }
  art.template.$player.dispatchEvent(new Event(SCRUB_EVENT));
}

/** Update the bar on the input event, without waiting for the media's timeupdate. */
export function seekAndSync(art: Artplayer, time: number) {
  if (!seekable(art) || !Number.isFinite(time)) return;
  const target = clamp(time, art.duration);
  art.seek = target;
  art.emit('setBar', 'played', target / art.duration);
  art.notice.show = art.template.$player.querySelector('[data-crayon-progress-time]')
    ? '' : `${formatDuration(target)} / ${formatDuration(art.duration)}`;
}

export function attachProgress(art: Artplayer) {
  const root = art.template.$player;
  const progress = art.template.$progress;
  const notice = root.querySelector<HTMLElement>('.art-notice');
  const noticeTop = notice?.style.top || '';
  const hud = document.createElement('div');
  hud.dataset.crayonProgressTime = '';
  hud.setAttribute('aria-label', '播放进度');
  hud.style.cssText = 'position:absolute;top:var(--art-padding,10px);left:var(--art-padding,10px);max-width:calc(100% - 24px);padding:4px 7px;border-radius:4px;background:#0009;color:white;font:12px/1.5 sans-serif;font-variant-numeric:tabular-nums;pointer-events:none;z-index:81';
  const mini = document.createElement('div');
  mini.dataset.crayonMiniProgress = '';
  mini.setAttribute('aria-hidden', 'true');
  mini.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;background:#ffffff40;pointer-events:none;z-index:90';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:var(--art-theme,#22c55e)';
  mini.appendChild(fill);
  root.append(hud, mini);
  let enabled = art.setting.find('crayonMiniProgress')?.switch ?? miniPreference(art.option.miniProgressBar);
  let displayed = art.currentTime;
  let dragging: { kind: 'touch'; id: number } | { kind: 'mouse' } | undefined;
  let suppressClickUntil = 0;
  const scrubbing = () => root.dataset.crayonScrubbing === 'true';
  const render = () => {
    const valid = seekable(art);
    const current = valid ? clamp(displayed, art.duration) : 0;
    hud.textContent = `${formatDuration(current)} / ${formatDuration(art.duration)}`;
    hud.hidden = !valid || art.isLock || !(art.controls.show || scrubbing());
    mini.hidden = !valid || !enabled || art.controls.show || scrubbing();
    fill.style.width = `${valid ? current / art.duration * 100 : 0}%`;
    if (notice) notice.style.top = hud.hidden ? noticeTop : '48px';
    if (progress && valid) {
      progress.setAttribute('aria-valuemax', String(art.duration));
      progress.setAttribute('aria-valuenow', String(current));
      progress.setAttribute('aria-valuetext', hud.textContent);
    }
  };
  const sync = () => { displayed = art.currentTime; render(); };
  const bar = (type: string, ratio: number) => {
    if (type === 'played' && Number.isFinite(ratio)) {
      displayed = seekable(art) ? clamp(ratio, 1) * art.duration : 0;
      render();
    }
  };
  const seek = () => {
    sync();
    if (seekable(art)) art.emit('setBar', 'played', clamp(art.currentTime / art.duration, 1));
  };
  const control = (visible: boolean) => {
    if (!visible && scrubbing()) { art.controls.show = true; return; }
    render();
  };
  const preference = (event: Event) => { enabled = (event as CustomEvent<boolean>).detail; render(); };
  const stop = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  const position = (point: { clientX: number; clientY: number }) => {
    if (!progress || !seekable(art)) return;
    const rect = progress.getBoundingClientRect();
    const size = art.isRotate ? rect.height : rect.width;
    if (size <= 0) return;
    const offset = art.isRotate ? point.clientY - rect.top : point.clientX - rect.left;
    seekAndSync(art, clamp(offset / size, 1) * art.duration);
  };
  const finish = () => {
    if (!dragging) return;
    dragging = undefined;
    suppressClickUntil = Date.now() + 800;
    setScrubbing(art, false);
  };
  const touchStart = (event: TouchEvent) => {
    if (art.isLock || !seekable(art) || event.touches.length !== 1) { finish(); stop(event); return; }
    stop(event);
    dragging = { kind: 'touch', id: event.touches[0].identifier };
    setScrubbing(art, true);
    position(event.touches[0]);
  };
  const touchMove = (event: TouchEvent) => {
    if (dragging?.kind !== 'touch') return;
    stop(event);
    if (event.touches.length !== 1 || event.touches[0].identifier !== dragging.id || art.isLock) { finish(); return; }
    position(event.touches[0]);
  };
  const touchEnd = (event: TouchEvent) => {
    if (dragging?.kind !== 'touch') return;
    const id = dragging.id;
    const point = Array.from(event.changedTouches).find(touch => touch.identifier === id);
    if (!point) return;
    stop(event);
    if (!art.isLock) position(point);
    finish();
  };
  const mouseStart = (event: MouseEvent) => {
    if (event.button !== 0 || art.isLock || !seekable(art)) return;
    stop(event);
    dragging = { kind: 'mouse' };
    setScrubbing(art, true);
    position(event);
  };
  const mouseMove = (event: MouseEvent) => {
    if (dragging?.kind !== 'mouse') return;
    stop(event);
    if (art.isLock) { finish(); return; }
    position(event);
  };
  const mouseEnd = (event: MouseEvent) => {
    if (dragging?.kind !== 'mouse') return;
    stop(event);
    if (!art.isLock) position(event);
    finish();
  };
  const click = (event: MouseEvent) => {
    if (Date.now() < suppressClickUntil || art.isLock) { stop(event); return; }
    stop(event); position(event);
  };
  const key = (event: KeyboardEvent) => {
    if (art.isLock || !seekable(art)) return;
    const targets: Record<string, number> = { ArrowLeft: art.currentTime - 5, ArrowRight: art.currentTime + 5, Home: 0, End: art.duration };
    if (!(event.key in targets)) return;
    stop(event); art.controls.show = true; seekAndSync(art, targets[event.key]);
  };
  const reset = () => { finish(); displayed = 0; render(); art.emit('setBar', 'played', 0); };
  const visibility = () => { if (document.hidden) finish(); };
  const oldTouchAction = progress?.style.touchAction;
  const attributes = ['role', 'tabindex', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'];
  const previous = attributes.map(name => progress?.getAttribute(name));
  if (progress) {
    progress.style.touchAction = 'none';
    progress.setAttribute('role', 'slider');
    progress.setAttribute('tabindex', '0');
    progress.setAttribute('aria-label', '播放进度条');
    progress.setAttribute('aria-valuemin', '0');
    progress.addEventListener('touchstart', touchStart, { capture: true, passive: false });
    progress.addEventListener('mousedown', mouseStart, true);
    progress.addEventListener('click', click, true);
    progress.addEventListener('keydown', key, true);
  }
  window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
  window.addEventListener('touchend', touchEnd, { capture: true, passive: false });
  window.addEventListener('touchcancel', finish, true);
  window.addEventListener('mousemove', mouseMove, true);
  window.addEventListener('mouseup', mouseEnd, true);
  window.addEventListener('blur', finish);
  document.addEventListener('visibilitychange', visibility);
  root.addEventListener(SCRUB_EVENT, render);
  root.addEventListener(MINI_EVENT, preference);
  art.on('control', control);
  art.on('setBar', bar);
  art.on('seek', seek);
  art.on('lock', finish);
  art.on('lock', render);
  art.video.addEventListener('loadstart', reset);
  art.on('video:emptied', reset);
  const timeEvents = ['video:timeupdate', 'video:loadedmetadata', 'video:durationchange'] as const;
  timeEvents.forEach(event => art.on(event, sync));
  render();
  return () => {
    finish(); hud.remove(); mini.remove();
    if (notice) notice.style.top = noticeTop;
    if (progress) {
      progress.style.touchAction = oldTouchAction || '';
      attributes.forEach((name, index) => {
        const old = previous[index];
        if (old == null) progress.removeAttribute(name); else progress.setAttribute(name, old);
      });
      progress.removeEventListener('touchstart', touchStart, true);
      progress.removeEventListener('mousedown', mouseStart, true);
      progress.removeEventListener('click', click, true);
      progress.removeEventListener('keydown', key, true);
    }
    window.removeEventListener('touchmove', touchMove, true);
    window.removeEventListener('touchend', touchEnd, true);
    window.removeEventListener('touchcancel', finish, true);
    window.removeEventListener('mousemove', mouseMove, true);
    window.removeEventListener('mouseup', mouseEnd, true);
    window.removeEventListener('blur', finish);
    document.removeEventListener('visibilitychange', visibility);
    root.removeEventListener(SCRUB_EVENT, render);
    root.removeEventListener(MINI_EVENT, preference);
    art.off('control', control);
    art.off('setBar', bar);
    art.off('seek', seek);
    art.off('lock', finish);
    art.off('lock', render);
    art.video.removeEventListener('loadstart', reset);
    art.off('video:emptied', reset);
    timeEvents.forEach(event => art.off(event, sync));
  };
}
