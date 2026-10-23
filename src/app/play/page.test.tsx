import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import Hls from 'hls.js';
import type { ReactNode } from 'react';

import { getSkipConfig, savePlayRecord } from '@/lib/db.client';
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
  fullscreenWeb = false;
  fullscreen = false;
  play = jest.fn(async () => undefined);
  notice = { show: '' };
  setting = { update: jest.fn() };
  destroy = jest.fn();
  events: Record<string, (() => void)[]> = {};
  on = (event: string, handler: () => void) => {
    (this.events[event] ||= []).push(handler);
  };
  emit(event: string) {
    this.events[event]?.forEach((callback) => callback());
  }
  constructor(
    public options?: {
      settings?: { name?: string; onClick?: () => void }[];
      gesture?: boolean;
      fastForward?: boolean;
      plugins?: unknown[];
      customType?: Record<string, (video: HTMLVideoElement, url: string) => void>;
    }
  ) {
    mockArtInstances.push(this);
  }
}
jest.mock('artplayer', () => ({
  __esModule: true,
  default: function (options: ConstructorParameters<typeof MockArt>[0]) {
    return new MockArt(options);
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
  jest.spyOn(Hls, 'isSupported').mockReturnValue(true);
  mockArtInstances.length = 0;
  localStorage.clear();
  jest.mocked(getSkipConfig).mockResolvedValue(null);
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
  jest.restoreAllMocks();
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


it('embeds only Crayon Player with enhanced touch/casting and webpage fullscreen', async () => {
  await openPage();
  expect(screen.queryByRole('group', { name: '选择播放器' })).toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
  expect(mockArtInstances[0].options).toEqual(expect.objectContaining({
    playsInline: true,
    fullscreen: false,
    fullscreenWeb: true,
    gesture: false,
    fastForward: false,
    plugins: [expect.any(Function)],
    settings: expect.arrayContaining([expect.objectContaining({ name: 'blockAds' })]),
  }));
});

it('keeps native-capable phones in MSE without injecting HTTP alternatives', async () => {
  const defaultFetch = global.fetch;
  const filter = {playlist:'', originalDuration:100, removed:[{start:30,end:40}], reason:'filtered'};
  const prepared = {url:'https://tv.example/api/player/media?token=clean',filter};
  global.fetch = jest.fn(async (input, init) => String(input) === '/api/player/prepare'
    ? {ok:true,json:async():Promise<typeof prepared>=>prepared}
    : defaultFetch(input,init)) as jest.Mock;
  jest.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
  jest.spyOn(Hls.prototype,'loadSource').mockImplementation(()=>undefined);
  jest.spyOn(Hls.prototype,'attachMedia').mockImplementation(()=>undefined);
  await openPage();
  const player = mockArtInstances[0];
  expect(player.video.querySelector('source')).toBeNull();
  expect(player.video.hasAttribute('src')).toBe(false);
  const hlsType = player.options?.customType?.m3u8;
  if (!hlsType) throw new Error('Missing HLS playback configuration');
  await act(async () => { hlsType(player.video, firstUrl); });
  expect(player.video.src).toBe('');
  expect(player.video.querySelector('source')).toBeNull();
  expect(player.video.hls).toBeDefined();
  expect(player.video.disableRemotePlayback).toBe(true);
  expect(Hls.prototype.loadSource).toHaveBeenCalledWith(prepared.url);
  expect(player.setting.update).toHaveBeenCalledWith({name:'blockAds',tooltip:'已过滤 10.0 秒'});
  expect(global.fetch).toHaveBeenCalledWith('/api/player/prepare',expect.objectContaining({method:'POST',credentials:'same-origin'}));
});

it('ignores saved external-player preferences and keeps every episode in Crayon',async()=>{
  localStorage.setItem(VOD_PLAYER_STORAGE_KEY,JSON.stringify({player:'juliang',entry:'backup1',smartMatch:false}));
  await openPage();
  expect(mockArtInstances).toHaveLength(1);
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.queryByRole('link',{name:'独立打开'})).toBeNull();
  expect(screen.queryByRole('button',{name:'巨量播放器'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'选择第二集'}));
  expect((mockArtInstances[0] as unknown as {switch:string}).switch).toBe('https://media.example/2.m3u8');
  expect(document.querySelector('iframe')).toBeNull();
});

it('rejects external player pages instead of opening another player or feeding HTML into HLS',async()=>{
  firstUrl='https://jimaoys99.com/s/movie?episode=2';
  await openPage();
  expect(screen.getByText(/Crayon Player 需要视频流/)).toBeVisible();
  expect(mockArtInstances).toHaveLength(0);
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.queryByText('🔄 视频加载中...')).toBeNull();
});

it('starts Crayon from the loading overlay when autoplay needs a user gesture',async()=>{
  await openPage();
  fireEvent.click(screen.getByRole('button',{name:'点击播放'}));
  expect(mockArtInstances[0].play).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('🔄 视频加载中...')).toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
});

it('uses webpage fullscreen for the F shortcut instead of native fullscreen',async()=>{
  await openPage();
  fireEvent.keyDown(document,{key:'f'});
  expect(mockArtInstances[0].fullscreenWeb).toBe(true);
  expect(mockArtInstances[0].fullscreen).toBe(false);
});

it('reports unsupported MSE and stops loading even when the phone can play native HLS',async()=>{
  await openPage();
  jest.spyOn(Hls,'isSupported').mockReturnValue(false);
  jest.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
  const player=mockArtInstances[0];
  const hlsType=player.options?.customType?.m3u8;
  if(!hlsType)throw Error('Missing HLS player');
  act(()=>hlsType(player.video,firstUrl));
  expect(screen.getByText(/此浏览器不支持 Crayon 网页播放/)).toBeVisible();
  expect(player.video.hasAttribute('src')).toBe(false);
  expect(player.video.querySelector('source')).toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
});

it('saves source progress and converts it when ad filtering is toggled in either direction', async () => {
  await openPage();
  const first = mockArtInstances[0];
  const report = {
    playlist: '',
    originalDuration: 100,
    removed: [{ start: 10, end: 20 }],
    reason: 'filtered' as const,
  };
  first.video.vodAdFilter = report;
  first.currentTime = 27;
  first.duration = 90;
  await act(async () => first.emit('pause'));
  expect(savePlayRecord).toHaveBeenLastCalledWith(
    'test',
    '1',
    expect.objectContaining({ play_time: 37, total_time: 100 })
  );
  act(() =>
    first.options?.settings
      ?.find((setting) => setting.name === 'blockAds')
      ?.onClick?.()
  );
  const unfiltered = mockArtInstances[1];
  act(() => unfiltered.emit('video:canplay'));
  expect(unfiltered.currentTime).toBe(37);
  expect(localStorage.getItem('enable_blockad')).toBe('false');
  act(() =>
    unfiltered.options?.settings
      ?.find((setting) => setting.name === 'blockAds')
      ?.onClick?.()
  );
  const filtered = mockArtInstances[2];
  filtered.video.vodAdFilter = report;
  act(() => filtered.emit('video:canplay'));
  expect(filtered.currentTime).toBe(27);
  expect(localStorage.getItem('enable_blockad')).toBe('true');
});

it('applies existing intro settings using source time after ad segments have been removed', async () => {
  jest
    .mocked(getSkipConfig)
    .mockResolvedValue({ enable: true, intro_time: 30, outro_time: 0 });
  await openPage();
  const native = mockArtInstances[0];
  native.video.vodAdFilter = {
    playlist: '',
    originalDuration: 100,
    removed: [{ start: 10, end: 20 }],
    reason: 'filtered',
  };
  native.currentTime = 11;
  act(() => native.emit('video:timeupdate'));
  expect(native.currentTime).toBe(20);
});
