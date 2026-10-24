import {
  buildCrayonPlayerUrl,
  buildJuliangPlayerUrl,
  CRAYON_PLAYER_ORIGIN,
  isJuliangPlayerUrl,
  readVodPlayerPreferences,
  saveVodPlayerPreferences,
  VOD_PLAYER_STORAGE_KEY,
} from './vod-player';

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

it('preserves signed URLs, reserved characters, unicode and existing percent encoding exactly once', () => {
  const media =
    'https://media.example/影片/index.m3u8?token=a%2Fb%2Bcd&expires=123&name=一 二#part';
  const result = new URL(buildJuliangPlayerUrl(media, 'main', true) || '');
  expect(result.origin + result.pathname).toBe('https://jimaoys99.com/parse');
  expect(result.searchParams.get('url')).toBe(media);
  expect(result.searchParams.has('match')).toBe(false);
});

it.each(['main', 'backup1', 'backup2'] as const)(
  'changes only the player entry (%s), keeping the complete source and match setting',
  (entry) => {
    const media = 'https://media.example/smart.m3u8?token=abc&b=1';
    const result = new URL(buildJuliangPlayerUrl(media, entry, false) || '');
    expect(result.hostname).toBe(
      {
        main: 'jimaoys99.com',
        backup1: 'jimaoys97.com',
        backup2: 'jimaoys95.com',
      }[entry]
    );
    expect(result.searchParams.get('url')).toBe(media);
    expect(result.searchParams.get('match')).toBe('0');
  }
);

it.each([
  '/s/movie-1?episode=2',
  '/parse?url=https%3A%2F%2Fmedia.example%2F1.m3u8&match=0',
])('never wraps an existing official player page twice: %s', (path) => {
  expect(
    buildJuliangPlayerUrl('https://jimaoys99.com' + path, 'backup1', true)
  ).toBe('https://jimaoys97.com' + path);
  expect(isJuliangPlayerUrl('https://jimaoys99.com' + path)).toBe(true);
  expect(isJuliangPlayerUrl('https://jimaoys99.com.evil.test' + path)).toBe(
    false
  );
});

it.each([
  'javascript:alert(1)',
  'data:text/html,x',
  'file:///video.m3u8',
  '/relative.m3u8',
  'https://user:secret@media.example/x.m3u8',
])('does not embed invalid or credential-bearing sources: %s', (url) => {
  expect(buildJuliangPlayerUrl(url, 'main', true)).toBeNull();
});

it('validates and persists browser preferences without changing existing ad settings', () => {
  const pref = {
    player: 'juliang',
    entry: 'backup2',
    smartMatch: false,
  } as const;
  localStorage.setItem('enable_blockad', 'false');
  saveVodPlayerPreferences(pref);
  expect(readVodPlayerPreferences()).toEqual(pref);
  expect(localStorage.getItem('enable_blockad')).toBe('false');
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    '{"player":"oops","entry":"__proto__","smartMatch":"false"}'
  );
  expect(readVodPlayerPreferences()).toEqual({
    player: 'crayon',
    entry: 'main',
    smartMatch: true,
  });
  localStorage.setItem(VOD_PLAYER_STORAGE_KEY, 'bad json');
  expect(readVodPlayerPreferences().player).toBe('crayon');
});

it('still allows session switching when browser storage is blocked', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readVodPlayerPreferences().player).toBe('crayon');
  expect(() =>
    saveVodPlayerPreferences({
      player: 'juliang',
      entry: 'main',
      smartMatch: true,
    })
  ).not.toThrow();
});

it('builds a minimal Crayon iframe URL without corrupting signed media', () => {
  const media =
    'https://media.example/影片/index.m3u8?token=a%2Fb%2Bcd&expires=123&name=一 二#part';
  const result = new URL(buildCrayonPlayerUrl(media) || '');
  expect(result.origin + result.pathname).toBe(CRAYON_PLAYER_ORIGIN + '/parse');
  expect(result.searchParams.get('url')).toBe(media);
  expect(result.searchParams.get('embed')).toBe('1');
  expect(Array.from(result.searchParams.keys()).sort()).toEqual([
    'embed',
    'url',
  ]);
});

it.each([
  '',
  '/relative.m3u8',
  'javascript:alert(1)',
  'data:text/html,x',
  'https://user:secret@media.example/video.mp4',
])('rejects invalid or credential-bearing Crayon sources: %s', (source) => {
  expect(buildCrayonPlayerUrl(source)).toBeNull();
});

it('normalizes an existing Crayon playback link and never wraps another player page', () => {
  const media = 'https://media.example/video.mp4?token=a%2Fb&x=1';
  const link =
    CRAYON_PLAYER_ORIGIN + '/?url=' + encodeURIComponent(media) + '&embed=0';
  const result = new URL(buildCrayonPlayerUrl(link) || '');
  expect(result.searchParams.get('url')).toBe(media);
  expect(result.pathname).toBe('/parse');
  expect(result.searchParams.get('embed')).toBe('1');
  expect(buildCrayonPlayerUrl(CRAYON_PLAYER_ORIGIN + '/')).toBeNull();
  expect(
    buildCrayonPlayerUrl(
      CRAYON_PLAYER_ORIGIN + '/auth/login?url=' + encodeURIComponent(media)
    )
  ).toBeNull();
  expect(
    buildCrayonPlayerUrl('https://jimaoys99.com/s/movie?episode=2')
  ).toBeNull();
});

it('migrates an existing artplayer selection to the hosted Crayon option', () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'artplayer', entry: 'backup2', smartMatch: false })
  );
  expect(readVodPlayerPreferences()).toEqual({
    player: 'crayon',
    entry: 'backup2',
    smartMatch: false,
  });
});
