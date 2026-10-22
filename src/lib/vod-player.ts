export type VodPlayer = 'artplayer' | 'juliang';
export type JuliangEntry = 'main' | 'backup1' | 'backup2';

export const JULIANG_ENTRIES: Record<
  JuliangEntry,
  { name: string; origin: string }
> = {
  main: { name: '主入口', origin: 'https://jimaoys99.com' },
  backup1: { name: '备用入口一', origin: 'https://jimaoys97.com' },
  backup2: { name: '备用入口二', origin: 'https://jimaoys95.com' },
};

export const VOD_PLAYER_STORAGE_KEY = 'vod_player_preferences';

export interface VodPlayerPreferences {
  player: VodPlayer;
  entry: JuliangEntry;
  smartMatch: boolean;
}

export function readVodPlayerPreferences(): VodPlayerPreferences {
  const defaults: VodPlayerPreferences = {
    player: 'artplayer',
    entry: 'main',
    smartMatch: true,
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(VOD_PLAYER_STORAGE_KEY) || '{}'
    );
    return {
      player: saved?.player === 'juliang' ? 'juliang' : 'artplayer',
      entry:
        saved?.entry === 'backup1' || saved?.entry === 'backup2'
          ? saved.entry
          : 'main',
      smartMatch:
        typeof saved?.smartMatch === 'boolean' ? saved.smartMatch : true,
    };
  } catch {
    return defaults;
  }
}

export function saveVodPlayerPreferences(value: VodPlayerPreferences) {
  try {
    localStorage.setItem(VOD_PLAYER_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Playback and switching still work when browser storage is unavailable.
  }
}

function parseMediaUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function isJuliangPlayerUrl(raw: string): boolean {
  const url = parseMediaUrl(raw);
  return (
    !!url &&
    Object.values(JULIANG_ENTRIES).some(
      ({ origin }) => url.origin === origin
    ) &&
    (url.pathname === '/parse' || url.pathname.startsWith('/s/'))
  );
}

export function buildJuliangPlayerUrl(
  mediaUrl: string,
  entry: JuliangEntry,
  smartMatch: boolean
): string | null {
  const url = parseMediaUrl(mediaUrl);
  if (!url) return null;
  const origin = JULIANG_ENTRIES[entry].origin;
  // jlplayer sources already contain a complete player page. Never parse twice.
  if (isJuliangPlayerUrl(mediaUrl)) {
    return origin + url.pathname + url.search + url.hash;
  }
  const query = new URLSearchParams({ url: mediaUrl });
  if (!smartMatch) query.set('match', '0');
  return `${origin}/parse?${query}`;
}
