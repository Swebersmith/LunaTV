import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import { savePlayRecord } from '@/lib/db.client';
import { VOD_PLAYER_STORAGE_KEY } from '@/lib/vod-player';

import PlayPage from './page';

const mockArtInstances: MockArt[] = [];
class MockArt {
  video = document.createElement('video');
  currentTime = 0;
  duration = 100;
  volume = 0.7;
  playbackRate = 1;
  paused = true;
  notice = { show: '' };
  destroy = jest.fn();
  events: Record<string, (() => void)[]> = {};
  on = (event: string, handler: () => void) => {
    (this.events[event] ||= []).push(handler);
  };
  emit(event: string) {
    this.events[event]?.forEach((callback) => callback());
  }
  constructor() {
    mockArtInstances.push(this);
  }
}
jest.mock('artplayer', () => ({
  __esModule: true,
  default: function () {
    return new MockArt();
  },
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
  default: ({ onChange }: { onChange: (value: number) => void }) => (
    <button onClick={() => onChange(1)}>选择第二集</button>
  ),
}));
jest.mock('@/lib/db.client', () => ({
  getAllPlayRecords: jest.fn(async () => ({})),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getSkipConfig: jest.fn(async () => null),
  isFavorited: jest.fn(async () => false),
  subscribeToDataUpdates: () => () => undefined,
  savePlayRecord: jest.fn(async () => undefined),
  getPlayProgressSaveInterval: () => 10000,
}));
jest.mock('@/lib/utils', () => ({ processImageUrl: (url: string) => url }));

let firstUrl = 'https://media.example/1.m3u8?token=a%2Fb&x=1';
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockArtInstances.length = 0;
  localStorage.clear();
  firstUrl = 'https://media.example/1.m3u8?token=a%2Fb&x=1';
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          source: 'test',
          id: '1',
          title: 'PlayerDemo',
          source_name: 'Test',
          year: '2026',
          poster: '',
          episodes: [firstUrl, 'https://media.example/2.m3u8'],
          episodes_titles: ['第一集', '第二集'],
        },
      ],
    }),
  })) as jest.Mock;
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function openPage() {
  render(<PlayPage />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}
function frame() {
  return screen.getByTitle('巨量播放器 · PlayerDemo');
}

it('releases HLS and pending auto-next when switching, then restores only the built-in position', async () => {
  await openPage();
  const native = mockArtInstances[0];
  const destroyHls = jest.fn();
  native.video.hls = { destroy: destroyHls } as unknown as NonNullable<
    HTMLVideoElement['hls']
  >;
  native.currentTime = 27;
  act(() => native.emit('video:ended'));
  fireEvent.click(screen.getByRole('button', { name: '巨量播放器' }));
  expect(native.destroy).toHaveBeenCalledTimes(1);
  expect(destroyHls).toHaveBeenCalledTimes(1);
  expect(savePlayRecord).toHaveBeenCalledWith(
    'test',
    '1',
    expect.objectContaining({ play_time: 27, index: 1 })
  );
  expect(new URL(frame().getAttribute('src') || '').searchParams.get('url')).toBe(
    firstUrl
  );
  expect(frame()).toHaveAttribute(
    'allow',
    'autoplay; fullscreen; picture-in-picture'
  );
  expect(frame()).toHaveAttribute('allowfullscreen');
  expect(frame()).not.toHaveAttribute('sandbox');
  expect(screen.queryByText('🔄 视频加载中...')).toBeNull();
  act(() => jest.advanceTimersByTime(1500));
  expect(new URL(frame().getAttribute('src') || '').searchParams.get('url')).toBe(
    firstUrl
  );
  fireEvent.click(screen.getByRole('button', { name: '内置播放器' }));
  expect(screen.queryByTitle('巨量播放器 · PlayerDemo')).toBeNull();
  const restored = mockArtInstances[1];
  act(() => restored.emit('video:canplay'));
  expect(restored.currentTime).toBe(27);
});

it('remembers selection, changes backup/matching independently, and replaces the iframe on episode changes', async () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'juliang', entry: 'backup1', smartMatch: false })
  );
  await openPage();
  expect(mockArtInstances).toHaveLength(0);
  const firstFrame = frame();
  expect(new URL(firstFrame.getAttribute('src') || '').hostname).toBe(
    'jimaoys97.com'
  );
  expect(
    new URL(firstFrame.getAttribute('src') || '').searchParams.get('match')
  ).toBe('0');
  fireEvent.change(screen.getByRole('combobox', { name: '巨量播放器入口' }), {
    target: { value: 'backup2' },
  });
  expect(frame()).not.toBe(firstFrame);
  fireEvent.click(screen.getByRole('checkbox', { name: '智能匹配线路' }));
  expect(new URL(frame().getAttribute('src') || '').searchParams.has('match')).toBe(
    false
  );
  fireEvent.click(screen.getByRole('button', { name: '选择第二集' }));
  expect(new URL(frame().getAttribute('src') || '').searchParams.get('url')).toBe(
    'https://media.example/2.m3u8'
  );
  expect(screen.getByRole('link', { name: '独立打开' })).toHaveAttribute(
    'href',
    frame().getAttribute('src')
  );
  expect(JSON.parse(localStorage.getItem(VOD_PLAYER_STORAGE_KEY) || '{}')).toEqual({
    player: 'juliang',
    entry: 'backup2',
    smartMatch: true,
  });
  fireEvent.click(screen.getByRole('button', { name: '内置播放器' }));
  act(() => mockArtInstances[0].emit('video:canplay'));
  expect(mockArtInstances[0].currentTime).toBe(0);
});

it('opens complete jlplayer pages directly and prevents sending HTML pages to HLS', async () => {
  firstUrl = 'https://jimaoys99.com/s/movie?episode=2';
  await openPage();
  expect(frame()).toHaveAttribute('src', firstUrl);
  expect(mockArtInstances).toHaveLength(0);
  expect(screen.getByRole('button', { name: '内置播放器' })).toBeDisabled();
});

it('keeps fallback controls usable when an entry is slow and does not claim video readiness from iframe load', async () => {
  localStorage.setItem(
    VOD_PLAYER_STORAGE_KEY,
    JSON.stringify({ player: 'juliang' })
  );
  await openPage();
  act(() => jest.advanceTimersByTime(12000));
  expect(screen.getByRole('status')).toHaveTextContent('切换备用入口');
  fireEvent.load(frame());
  expect(screen.getByRole('status')).toHaveTextContent('未出画面');
  fireEvent.click(screen.getByText('广告屏蔽与使用说明'));
  expect(screen.getByText(/进度不会同步到本站/)).toBeVisible();
});
