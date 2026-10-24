import type Artplayer from 'artplayer';

type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void | Promise<void> };

function fullscreenElement(document: FullscreenDocument) {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

/** Fullscreen the entire player so its controls and gestures remain available. */
export async function toggleCrayonFullscreen(art: Artplayer): Promise<void> {
  if (art.isDestroy) return;
  const root = art.template.$player as FullscreenRoot;
  const document = root.ownerDocument as FullscreenDocument;
  if (fullscreenElement(document) === root) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) await exit.call(document);
    return;
  }
  if (art.fullscreenWeb) { art.fullscreenWeb = false; return; }
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  if (enter) {
    try { await enter.call(root); return; } catch { /* Element fullscreen can be denied by the host. */ }
  }
  if (!art.isDestroy) art.fullscreenWeb = true;
}

/** Override only the fullscreen button's action, never the media playback path. */
export function attachFullscreen(art: Artplayer) {
  const root = art.template.$player;
  const document = root.ownerDocument as FullscreenDocument;
  const button = root.querySelector<HTMLElement>('.art-control-fullscreen');
  const toggle = () => { void toggleCrayonFullscreen(art).catch(() => { art.notice.show = '无法退出全屏，请使用设备返回或退出全屏键'; }); };
  const onClick = (event: Event) => {
    if (!button?.contains(event.target as Node)) return;
    event.preventDefault(); event.stopImmediatePropagation(); toggle();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.target !== button || !['Enter',' '].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); toggle();
  };
  const sync = () => {
    const active = fullscreenElement(document) === root || art.fullscreenWeb;
    button?.setAttribute('aria-label', active ? '退出全屏' : '全屏');
    root.classList.toggle('art-fullscreen', fullscreenElement(document) === root);
    const icons = button?.querySelectorAll<HTMLElement>('.art-icon');
    if (icons?.length === 2) {
      icons[0].style.display = active ? 'none' : 'inline-flex';
      icons[1].style.display = active ? 'inline-flex' : 'none';
    }
  };
  if (button) { button.setAttribute('role','button'); button.tabIndex = 0; }
  const onDoubleClick = () => {
    if (art.option.fullscreen) toggle();
    else if (art.option.fullscreenWeb) art.fullscreenWeb = !art.fullscreenWeb;
  };
  root.addEventListener('click',onClick,true);
  root.addEventListener('keydown',onKey,true);
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('webkitfullscreenchange',sync);
  art.on('fullscreenWeb',sync);
  art.on('dblclick',onDoubleClick);
  sync();
  const destroy = art.destroy.bind(art);
  art.destroy = (removeHtml = true) => {
    if (art.isDestroy) return;
    if (art.fullscreenWeb) art.fullscreenWeb = false;
    if (fullscreenElement(document) === root) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try { void Promise.resolve(exit.call(document)).catch(() => undefined); } catch { /* Removing the player also releases fullscreen. */ }
      }
    }
    destroy(removeHtml);
  };
  art.on('destroy',() => {
    root.removeEventListener('click',onClick,true);
    root.removeEventListener('keydown',onKey,true);
    document.removeEventListener('fullscreenchange',sync);
    document.removeEventListener('webkitfullscreenchange',sync);
    art.off('fullscreenWeb',sync);
    art.off('dblclick',onDoubleClick);
  });
}
