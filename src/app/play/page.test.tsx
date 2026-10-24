import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAllPlayRecords, savePlayRecord } from '@/lib/db.client';
import { CRAYON_PLAYER_ORIGIN, VOD_PLAYER_STORAGE_KEY } from '@/lib/vod-player';

import PlayPage from './page';

// The host must no longer create a second video or load its old playback engine.
jest.mock('artplayer', () => ({
  __esModule: true,
  default: jest.fn(() => {
    throw new Error('The built-in player must not start');
  }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () =>
    new URLSearchParams('source=test&id=1&title=PlayerDemo'),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: ({
    onChange,
    onSourceChange,
  }: {
    onChange: (value: number) => void;
    onSourceChange: (source: string, id: string, title: string) => void;
  }) => (
    <>
      <button onClick={() => onChange(1)}>选择第二集</button>
      <button onClick={() => onSourceChange('other', '2', 'PlayerDemo')}>
        切换播放源
      </button>
      <button onClick={() => onSourceChange('short', '3', 'PlayerDemo')}>
        切换单集源
      </button>
    </>
  ),
}));
jest.mock('@/lib/db.client', () => ({
  getAllPlayRecords: jest.fn(async () => ({})),
  generateStorageKey: (source: string, id: string) => source + '+' + id,
  isFavorited: jest.fn(async () => false),
  subscribeToDataUpdates: () => () => undefined,
  savePlayRecord: jest.fn(async () => undefined),
}));
jest.mock('@/lib/utils', () => ({ processImageUrl: (url: string) => url }));

let firstUrl = '';
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  jest.mocked(getAllPlayRecords).mockResolvedValue({});
  firstUrl = 'https://media.example/1.m3u8?token=a%2Fb&x=1';
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          source: 'test',
          id: '1',
          episodes: [firstUrl, 'https://media.example/2.m3u8'],
        },
        {
          source: 'other',
          id: '2',
          episodes: [
            'https://other.example/1.m3u8',
            'https://other.example/2.m3u8',
          ],
        },
        { source: 'short', id: '3', episodes: ['https://short.example/1.mp4'] },
      ].map((source) => ({
        ...source,
        title: 'PlayerDemo',
        source_name: source.source,
        year: '2026',
        poster: '',
        episodes_titles: ['第一集', '第二集'],
      })),
    }),
  })) as jest.Mock;
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});
function frame(player = 'Crayon Player') {
  return screen.getByTitle(player + ' · PlayerDemo');
}
function embeddedMedia(player?: string) {
  return new URL(frame(player).getAttribute('src') || '').searchParams.get(
    'url'
  );
}
async function openPage() {
  render(<PlayPage />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

it('replaces built-in Crayon with the hosted iframe and keeps signed media intact', async () => {
  await openPage();
  const url = new URL(frame().getAttribute('src') || '');
  expect(url.origin + url.pathname).toBe(CRAYON_PLAYER_ORIGIN + '/parse');
  expect(url.searchParams.get('embed')).toBe('1');
  expect(embeddedMedia()).toBe(firstUrl);
  expect(frame()).toHaveAttribute(
    'allow',
    expect.stringContaining('autoplay; fullscreen; picture-in-picture')
  );
  expect(frame()).toHaveAttribute(
    'allow',
    expect.stringContaining('screen-wake-lock')
  );
  expect(frame()).toHaveAttribute('allowfullscreen');
  expect(frame()).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(frame()).not.toHaveAttribute('sandbox');
  expect(document.querySelector('video')).toBeNull();
  expect(screen.queryByText('🔄 视频加载中...')).toBeNull();
  expect(screen.getByRole('link', { name: '独立打开' })).toHaveAttribute(
    'href',
    url.href
  );
  expect(screen.getByText(/首次使用请在播放器内输入访问密码/)).toBeVisible();
});

it('migrates the saved built-in player choice to hosted Crayon', async () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'artplayer' })
  );
  await openPage();
  expect(screen.getByRole('button', { name: 'Crayon Player' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(embeddedMedia()).toBe(firstUrl);
});

it('unmounts each old iframe when switching players and keeps independent preferences', async () => {
  await openPage();
  const crayon = frame();
  fireEvent.click(screen.getByRole('button', { name: '巨量播放器' }));
  expect(crayon).not.toBeInTheDocument();
  expect(embeddedMedia('巨量播放器')).toBe(firstUrl);
  const juliang = frame('巨量播放器');
  fireEvent.click(screen.getByRole('button', { name: 'Crayon Player' }));
  expect(juliang).not.toBeInTheDocument();
  expect(frame()).not.toBe(crayon);
  expect(
    JSON.parse(localStorage.getItem(VOD_PLAYER_STORAGE_KEY) || '{}').player
  ).toBe('crayon');
  expect(savePlayRecord).not.toHaveBeenCalled();
});

it('replaces Crayon on episode and source changes, preserving the selected episode where available', async () => {
  await openPage();
  const first = frame();
  fireEvent.click(screen.getByRole('button', { name: '选择第二集' }));
  expect(first).not.toBeInTheDocument();
  expect(embeddedMedia()).toBe('https://media.example/2.m3u8');
  const second = frame();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '切换播放源' }));
  });
  expect(second).not.toBeInTheDocument();
  expect(embeddedMedia()).toBe('https://other.example/2.m3u8');
  expect(window.location.search).toContain('source=other');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '切换单集源' }));
  });
  expect(embeddedMedia()).toBe('https://short.example/1.mp4');
});

it('restores Juliang selection, backup entry and smart matching', async () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'juliang', entry: 'backup1', smartMatch: false })
  );
  await openPage();
  const first = frame('巨量播放器');
  expect(new URL(first.getAttribute('src') || '').hostname).toBe(
    'jimaoys97.com'
  );
  expect(
    new URL(first.getAttribute('src') || '').searchParams.get('match')
  ).toBe('0');
  fireEvent.change(screen.getByRole('combobox', { name: '巨量播放器入口' }), {
    target: { value: 'backup2' },
  });
  expect(first).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '智能匹配线路' }));
  expect(
    new URL(frame('巨量播放器').getAttribute('src') || '').searchParams.has(
      'match'
    )
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '选择第二集' }));
  expect(embeddedMedia('巨量播放器')).toBe('https://media.example/2.m3u8');
});

it('embeds complete Juliang player pages directly', async () => {
  firstUrl = 'https://jimaoys99.com/s/movie?episode=2';
  await openPage();
  expect(frame('巨量播放器')).toHaveAttribute('src', firstUrl);
  expect(screen.getByRole('button', { name: 'Crayon Player' })).toBeDisabled();
});

it('shows Crayon fallback and login guidance without treating iframe load as playback success', async () => {
  await openPage();
  act(() => jest.advanceTimersByTime(12000));
  expect(screen.getByRole('status')).toHaveTextContent('切换巨量播放器');
  fireEvent.load(frame());
  expect(screen.getByRole('status')).toHaveTextContent('若显示登录页');
  expect(screen.getByRole('status')).toHaveTextContent('未出画面');
  expect(screen.getByRole('link', { name: '独立打开' })).toBeEnabled();
});

it('keeps Juliang fallback controls available after a slow load', async () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'juliang' })
  );
  await openPage();
  act(() => jest.advanceTimersByTime(12000));
  expect(screen.getByRole('status')).toHaveTextContent('切换备用入口');
  fireEvent.load(frame('巨量播放器'));
  expect(screen.getByRole('status')).toHaveTextContent('未出画面');
});

it('rejects invalid media and keeps player switching available', async () => {
  firstUrl = 'javascript:alert(1)';
  await openPage();
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(
    '当前地址无法交给Crayon Player播放'
  );
  expect(screen.queryByRole('link', { name: '独立打开' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '巨量播放器' }));
  expect(screen.getByRole('alert')).toHaveTextContent('巨量播放器');
});

it('keeps page episode shortcuts with no duplicate playback controls', async () => {
  await openPage();
  fireEvent.keyDown(document.body, { altKey: true, key: 'ArrowRight' });
  expect(embeddedMedia()).toBe('https://media.example/2.m3u8');
  fireEvent.keyDown(document.body, { altKey: true, key: 'ArrowLeft' });
  expect(embeddedMedia()).toBe(firstUrl);
  expect(savePlayRecord).not.toHaveBeenCalled();
});

it.each([
  [2, 'https://media.example/2.m3u8'],
  [20, 'https://media.example/1.m3u8?token=a%2Fb&x=1'],
  [-1, 'https://media.example/1.m3u8?token=a%2Fb&x=1'],
] as const)(
  'preserves valid history episode selection and clamps old indices (%s)',
  async (index, media) => {
    jest.mocked(getAllPlayRecords).mockResolvedValue({
      'test+1': {
        title: 'PlayerDemo',
        source_name: 'test',
        year: '2026',
        cover: '',
        index,
        total_episodes: 20,
        play_time: 42,
        total_time: 100,
        save_time: 1,
      },
    });
    await openPage();
    expect(embeddedMedia()).toBe(media);
    expect(
      new URL(frame().getAttribute('src') || '').searchParams.has('time')
    ).toBe(false);
    expect(savePlayRecord).not.toHaveBeenCalled();
  }
);
