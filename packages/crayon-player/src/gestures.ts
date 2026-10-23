import type Artplayer from 'artplayer';

export interface GestureOptions {
  seekSeconds?: number;
  holdRate?: number;
  holdDelay?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type Zone = 'left' | 'center' | 'right';

/** Own only touches on the picture. Native controls, mouse and lock stay usable. */
export function attachGestures(art: Artplayer, options: GestureOptions = {}) {
  const root = art.template.$player;
  const video = art.video;
  const seekSeconds = options.seekSeconds ?? 10;
  const holdRate = options.holdRate ?? 2;
  const originalTouchAction = video.style.touchAction;
  video.style.touchAction = 'none';
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTap: { x: number; y: number; zone: Zone; time: number } | undefined;
  let suppressClickUntil = 0;
  let active: {
    id: number; x: number; y: number; zone: Zone;
    time: number; volume: number; rate: number;
    direction?: 'horizontal' | 'vertical'; held: boolean;
  } | undefined;

  const picture = (target: EventTarget | null) => target === video;
  const stop = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  const clearTap = () => {
    clearTimeout(tapTimer);
    lastTap = undefined;
  };
  const restoreRate = () => {
    clearTimeout(holdTimer);
    if (active?.held) art.playbackRate = active.rate;
  };
  const cancel = () => {
    restoreRate();
    active = undefined;
    clearTap();
  };
  const seek = (time: number) => {
    if (art.option.isLive || !Number.isFinite(art.duration) || art.duration <= 0) return;
    art.seek = clamp(time, 0, art.duration);
  };
  const start = (event: TouchEvent) => {
    if (!picture(event.target) || art.isLock) return;
    if (event.touches.length !== 1) { cancel(); stop(event); return; }
    cancelActive();
    stop(event);
    const touch = event.touches[0];
    const rect = video.getBoundingClientRect();
    active = {
      id: touch.identifier, x: touch.clientX, y: touch.clientY,
      zone: (() => {
        const ratio = art.isRotate
          ? (touch.clientY - rect.top) / rect.height
          : (touch.clientX - rect.left) / rect.width;
        return ratio < 1 / 3 ? 'left' : ratio > 2 / 3 ? 'right' : 'center';
      })(),
      time: art.currentTime, volume: art.volume,
      rate: art.playbackRate, held: false,
    };
    suppressClickUntil = Date.now() + 1000;
    holdTimer = setTimeout(() => {
      if (!active || active.direction || art.isLock || !art.playing || art.option.isLive) return;
      active.held = true;
      clearTap();
      art.playbackRate = Math.max(active.rate, holdRate);
      art.notice.show = `长按 ${art.playbackRate}× 加速 · 松手恢复`;
    }, options.holdDelay ?? 500);
  };
  function cancelActive() {
    restoreRate();
    active = undefined;
  }
  const move = (event: TouchEvent) => {
    if (!active) return;
    stop(event);
    if (event.touches.length !== 1 || art.isLock) { cancel(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== active.id) { cancel(); return; }
    const rect = video.getBoundingClientRect();
    // Map screen coordinates back to the player's axes in ArtPlayer's rotated fullscreen.
    const dx = art.isRotate ? touch.clientY - active.y : touch.clientX - active.x;
    const dy = art.isRotate ? active.x - touch.clientX : touch.clientY - active.y;
    if (!active.direction && Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
    if (!active.direction) {
      active.direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      restoreRate();
      clearTap();
    }
    if (active.direction === 'horizontal') {
      const width = (art.isRotate ? rect.height : rect.width) || 1;
      seek(active.time + dx / width * Math.min(art.duration || 0, 300));
      if (!art.option.isLive) art.notice.show = `进度 ${Math.floor(art.currentTime)} 秒`;
    } else {
      const height = (art.isRotate ? rect.width : rect.height) || 1;
      const delta = -dy / (height * 0.8);
      if (active.zone === 'right') {
        const target = clamp(active.volume + delta, 0, 1);
        art.volume = target;
        if (target > 0) art.muted = false;
        art.notice.show = Math.abs(video.volume - target) > 0.02
          ? '此浏览器限制网页音量，请使用设备音量键'
          : `音量 ${Math.round(video.volume * 100)}%`;
      }
    }
  };
  const end = (event: TouchEvent) => {
    if (!active) return;
    if (!Array.from(event.changedTouches).some(t => t.identifier === active?.id)) return;
    stop(event);
    suppressClickUntil = Date.now() + 800;
    const ended = active;
    restoreRate();
    active = undefined;
    if (ended.direction || ended.held || art.isLock) { clearTap(); return; }
    const now = Date.now();
    if (lastTap && now - lastTap.time < 300 && lastTap.zone === ended.zone &&
      Math.hypot(lastTap.x - ended.x, lastTap.y - ended.y) < 80) {
      clearTap();
      if (ended.zone === 'center') {
        art.toggle();
        art.notice.show = art.playing ? '继续播放' : '已暂停';
      } else if (!art.option.isLive) {
        const before = art.currentTime;
        seek(before + (ended.zone === 'right' ? seekSeconds : -seekSeconds));
        art.notice.show = `${ended.zone === 'right' ? '快进' : '快退'} ${Math.abs(Math.round(art.currentTime - before))} 秒`;
      }
    } else {
      clearTimeout(tapTimer);
      lastTap = { x: ended.x, y: ended.y, zone: ended.zone, time: now };
      tapTimer = setTimeout(() => {
        lastTap = undefined;
        if (!art.isLock && !art.isDestroy) art.controls.toggle();
      }, 300);
    }
  };
  const click = (event: MouseEvent) => {
    if (picture(event.target) && Date.now() < suppressClickUntil) stop(event);
  };
  const context = (event: Event) => { if (active && picture(event.target)) stop(event); };
  const visibility = () => { if (document.hidden) cancel(); };
  root.addEventListener('touchstart', start, { capture: true, passive: false });
  root.addEventListener('touchmove', move, { capture: true, passive: false });
  window.addEventListener('touchend', end, { capture: true, passive: false });
  window.addEventListener('touchcancel', cancel, true);
  root.addEventListener('click', click, true);
  root.addEventListener('dblclick', click, true);
  root.addEventListener('contextmenu', context, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', visibility);
  video.addEventListener('loadstart', cancel);
  art.on('lock', cancel);
  return () => {
    cancel();
    video.style.touchAction = originalTouchAction;
    root.removeEventListener('touchstart', start, true);
    root.removeEventListener('touchmove', move, true);
    window.removeEventListener('touchend', end, true);
    window.removeEventListener('touchcancel', cancel, true);
    root.removeEventListener('click', click, true);
    root.removeEventListener('dblclick', click, true);
    root.removeEventListener('contextmenu', context, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', visibility);
    video.removeEventListener('loadstart', cancel);
    art.off('lock', cancel);
  };
}
