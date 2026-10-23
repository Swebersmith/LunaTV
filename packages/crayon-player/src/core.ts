import Artplayer from 'artplayer';

import { configureInlineVideo } from './inline-video';
import { volumeSetting } from './player-ui';
import { crayonPlayerPlugin, EnhancementOptions } from './plugin';
import { miniProgressSetting } from './progress';

export type CrayonPlayerCoreOptions = ConstructorParameters<typeof Artplayer>[0];

/** Shared player used by the standalone player and host websites. */
export function createCrayonPlayerCore(
  options: CrayonPlayerCoreOptions,
  enhancements: EnhancementOptions = {}
): Artplayer {
  Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  Artplayer.USE_RAF = false;
  Artplayer.FULLSCREEN_WEB_IN_BODY = true;
  Artplayer.LOG_VERSION = false;
  Artplayer.DBCLICK_FULLSCREEN = false;
  const art = new Artplayer({
    ...options,
    playsInline: true,
    fullscreen: false,
    fullscreenWeb: true,
    moreVideoAttr: { ...options.moreVideoAttr, controls: false, playsInline: true },
    gesture: false,
    fastForward: false,
    miniProgressBar: false,
    settings: [volumeSetting(), miniProgressSetting(options.miniProgressBar), ...(options.settings || [])],
    plugins: [...(options.plugins || []), crayonPlayerPlugin(enhancements)],
  });
  if (art.video) configureInlineVideo(art.video);
  art.on?.('dblclick', () => { art.fullscreenWeb = !art.fullscreenWeb; });
  art.template?.$player?.setAttribute('data-player', 'crayon-player');
  art.contextmenu?.update({
    name: 'version',
    html: '<a href="https://github.com/Swebersmith/CrayonPlayer" target="_blank" rel="noopener noreferrer">Crayon Player</a>',
  });
  return art;
}
