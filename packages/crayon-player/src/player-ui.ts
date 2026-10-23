import type Artplayer from 'artplayer';
import type { Setting } from 'artplayer/types/setting';

/** A tappable setting opens a real range input, including on phones. */
export function volumeSetting(): Setting {
  return {
    name: 'crayonVolume', html: '音量', tooltip: '点击调节',
    selector: [{
      name: 'crayonVolumeRange', html: '播放音量', range: [70, 0, 100, 1],
      mounted() {
        const item = this.setting.find('crayonVolumeRange');
        item.range = [Math.round(this.volume * 100), 0, 100, 1];
        item.$range.setAttribute('aria-label', '播放音量');
        item.$range.style.width = '100px';
        item.$range.style.height = '24px';
      },
      onChange(item) {
        const target = (item.range[0] || 0) / 100;
        this.volume = target;
        this.muted = target === 0;
        if (Math.abs(this.video.volume - target) > 0.02) {
          this.notice.show = '此浏览器限制网页音量，请使用设备音量键';
          return '请使用设备音量键';
        }
        return `${Math.round(this.video.volume * 100)}%`;
      },
    }],
  };
}

export function attachPlayerUi(art: Artplayer, showGestures = true) {
  const root = art.template.$player;
  const oldMaxHeight = root.style.getPropertyValue('--art-settings-max-height');
  root.style.setProperty('--art-settings-max-height', 'min(300px, calc(100% - 56px))');
  let lastActivity = Date.now();
  let guideTimer: ReturnType<typeof setTimeout> | undefined;
  const guide = document.createElement('div');
  guide.setAttribute('aria-label', '触屏手势提示');
  guide.setAttribute('role', 'status');
  guide.hidden = true;
  guide.style.cssText = 'position:absolute;inset:0;z-index:12;pointer-events:none;background:linear-gradient(transparent,#0009);color:white;font:12px/1.6 sans-serif;text-align:center';
  const row = document.createElement('div');
  row.style.cssText = 'position:absolute;inset:25% 0 25%;display:grid;grid-template-columns:repeat(3,1fr);align-items:center';
  ['左侧双击\n快退 10 秒', '中间双击\n暂停 / 继续', '右侧双击\n快进 10 秒'].forEach((text, index) => {
    const cell = document.createElement('div');
    cell.textContent = text;
    cell.style.cssText = `white-space:pre-line;padding:10px 4px;${index ? 'border-left:1px solid #fff5;' : ''}`;
    row.appendChild(cell);
  });
  const foot = document.createElement('div');
  foot.textContent = '左右滑动或拖动进度条调节进度 · 长按加速 · 右侧上下滑调节音量';
  foot.style.cssText = 'position:absolute;bottom:18%;width:100%;font-size:11px';
  guide.append(row, foot);
  root.appendChild(guide);
  const dismissGuide = () => { guide.hidden = true; clearTimeout(guideTimer); };
  const showGuide = () => {
    if (!showGestures) return;
    if (!(navigator.maxTouchPoints > 0 || 'ontouchstart' in window)) return;
    try {
      if (sessionStorage.getItem('crayon-player-gesture-guide-v2')) return;
      sessionStorage.setItem('crayon-player-gesture-guide-v2', '1');
    } catch { /* The guide still works without browser storage. */ }
    guide.hidden = false;
    guideTimer = setTimeout(dismissGuide, 4500);
  };
  const activity = () => { lastActivity = Date.now(); };
  const control = (visible: boolean) => {
    if (visible) activity();
    else if (art.setting.show) art.setting.show = false;
  };
  const setting = (visible: boolean) => { if (visible) { activity(); art.controls.show = true; } };
  const autoHide = () => {
    // ArtPlayer normally pins the controls while settings are open. Share one hide cycle.
    if (art.playing && art.setting.show && !root.dataset.crayonScrubbing && Date.now() - lastActivity >= 3000) {
      art.setting.show = false;
      art.controls.show = false;
    }
  };
  const syncVolume = () => {
    const item = art.setting.find('crayonVolumeRange');
    if (item) {
      item.range = [Math.round(art.volume * 100), 0, 100, 1];
      item.tooltip = `${Math.round(art.volume * 100)}%`;
    }
  };
  const events = ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'input', 'keydown'];
  events.forEach(event => root.addEventListener(event, activity, { capture: true, passive: true }));
  root.addEventListener('touchstart', dismissGuide, { capture: true, passive: true });
  art.on('play', showGuide);
  art.on('control', control);
  art.on('setting', setting);
  art.on('video:timeupdate', autoHide);
  art.on('video:volumechange', syncVolume);
  return () => {
    dismissGuide(); guide.remove();
    if (oldMaxHeight) root.style.setProperty('--art-settings-max-height',oldMaxHeight);
    else root.style.removeProperty('--art-settings-max-height');
    events.forEach(event => root.removeEventListener(event, activity, true));
    root.removeEventListener('touchstart', dismissGuide, true);
    art.off('play', showGuide);
    art.off('control', control);
    art.off('setting', setting);
    art.off('video:timeupdate', autoHide);
    art.off('video:volumechange', syncVolume);
  };
}
