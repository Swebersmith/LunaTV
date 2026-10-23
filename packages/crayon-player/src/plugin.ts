import type Artplayer from 'artplayer';

import { attachCasting, CastOptions } from './casting';
import { attachGestures, GestureOptions } from './gestures';
import { attachPlayerUi } from './player-ui';

export interface EnhancementOptions {
  gestures?: GestureOptions | false;
  casting?: CastOptions | false;
}

/** ArtPlayer plugin; install with fastForward:false and gesture:false to avoid duplicate gestures. */
export function crayonPlayerPlugin(options: EnhancementOptions = {}) {
  return (art: Artplayer) => {
    const disposeUi = attachPlayerUi(art);
    const disposeGestures = options.gestures === false ? undefined : attachGestures(art, options.gestures);
    const disposeCast = options.casting ? attachCasting(art, options.casting) : undefined;
    let disposed = false;
    const destroy = () => {
      if (disposed) return;
      disposed = true;
      disposeGestures?.();
      disposeCast?.();
      disposeUi();
    };
    art.on('destroy', destroy);
    return { name: 'crayonPlayer', destroy };
  };
}
