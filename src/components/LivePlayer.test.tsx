/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen } from '@testing-library/react';
import Hls from 'hls.js';

import * as playlists from '@/lib/live-playlist-loader';

import LivePlayer from './LivePlayer';

const mockPlayers: any[] = [];
const mockHls: any[] = [];
jest.mock('@/lib/live-playlist-loader', () => {
  const actual = jest.requireActual('@/lib/live-playlist-loader');
  return { ...actual, livePlaylistLoader: jest.fn(actual.livePlaylistLoader) };
});
jest.mock('artplayer', () => ({
  __esModule: true,
  default: class {
    video = document.createElement('video');
    events: Record<string, () => void> = {};
    destroy = jest.fn();
    constructor(options: any) {
      mockPlayers.push(this);
      options.container.appendChild(this.video);
      options.customType[options.type]?.(this.video, options.url);
    }
    on(event: string, callback: () => void) {
      this.events[event] = callback;
    }
  },
}));
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static DefaultConfig: { loader: new () => object } = { loader: class {} };
    static isSupported(): boolean {
      return true;
    }
    static Events: Record<string, string> = { ERROR: 'error' };
    static ErrorTypes: Record<string, string> = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    };
    on = jest.fn((_name, callback) => {
      this.error = callback;
    });
    error: any;
    loadSource = jest.fn();
    attachMedia = jest.fn();
    destroy = jest.fn();
    stopLoad = jest.fn();
    startLoad = jest.fn();
    recoverMediaError = jest.fn();
    constructor() {
      mockHls.push(this);
    }
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockPlayers.length = 0;
  mockHls.length = 0;
  jest
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
});

it('automatically retries a failed direct connection through the proxy', () => {
  localStorage.setItem('liveDirectConnect', 'true');
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  expect(mockHls[0].loadSource.mock.calls[0][0]).toContain('allowCORS=true');
  act(() => mockHls[0].error('error', { fatal: true, type: 'networkError' }));
  expect(mockHls[0].destroy).toHaveBeenCalledTimes(1);
  expect(mockHls[1].loadSource.mock.calls[0][0]).not.toContain('allowCORS');
});

it('reports expired authentication without cycling through station alternatives', () => {
  const onUnavailable = jest.fn();
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
      onUnavailable={onUnavailable}
    />
  );
  act(() =>
    mockHls[0].error('error', {
      fatal: true,
      type: 'networkError',
      response: { code: 401 },
    })
  );
  expect(screen.getByRole('alert')).toHaveTextContent('登录已失效');
  act(() => {
    mockPlayers[0].events['video:playing']();
    mockPlayers[0].events['video:timeupdate']();
    mockPlayers[0].events['video:waiting']();
  });
  expect(screen.getByRole('alert')).toHaveTextContent('登录已失效');
  expect(onUnavailable).not.toHaveBeenCalled();
});

it('also falls back to full proxy when native HLS direct playback fails', () => {
  localStorage.setItem('liveDirectConnect', 'true');
  jest.spyOn(Hls, 'isSupported').mockReturnValue(false);
  jest
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockReturnValue('maybe');
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  Object.defineProperty(mockPlayers[0].video, 'error', { value: { code: 2 } });
  act(() => mockPlayers[0].events['video:error']());
  expect(mockPlayers[0].destroy).toHaveBeenCalledTimes(1);
  expect(mockPlayers[1].video.src).not.toContain('allowCORS');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('falls back to native HLS and offers a play button when autoplay is blocked', async () => {
  jest.spyOn(Hls, 'isSupported').mockReturnValue(false);
  jest
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockReturnValue('maybe');
  jest
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new Error('NotAllowedError'));
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  expect(mockHls).toHaveLength(0);
  expect(mockPlayers[0].video.src).toContain('moontv-source=test');
  await act(async () => {
    mockPlayers[0].events['video:canplay']();
  });
  fireEvent.click(screen.getByRole('button', { name: '点击播放直播' }));
  await act(async () => undefined);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
});

it('bounds network recovery, exposes retry and destroys the previous player', () => {
  jest.useFakeTimers();
  const view = render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  for (let count = 0; count < 3; count++)
    act(() => {
      mockHls[0].error('error', { fatal: true, type: 'networkError' });
      jest.advanceTimersByTime(3000);
    });
  expect(mockHls[0].startLoad).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('alert')).toHaveTextContent('频道暂时无法播放');
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect(mockHls[0].destroy).toHaveBeenCalledTimes(1);
  expect(mockHls).toHaveLength(2);
  view.unmount();
  expect(mockHls[1].destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('recovers one media failure and reports an unsupported codec instead of looping', () => {
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  act(() => {
    mockHls[0].error('error', { fatal: true, type: 'mediaError' });
  });
  expect(mockHls[0].recoverMediaError).toHaveBeenCalledTimes(1);
  act(() => {
    mockHls[0].error('error', { fatal: true, type: 'mediaError' });
  });
  expect(screen.getByRole('alert')).toBeVisible();
});

it('does not create an obsolete player when an extensionless precheck finishes after a channel switch', async () => {
  const original = global.fetch;
  let finish: any;
  global.fetch = jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const ref = { current: null };
  const view = render(
    <LivePlayer url='https://media.test/old' source='test' playerRef={ref} />
  );
  view.rerender(
    <LivePlayer
      url='https://media.test/new.m3u8'
      source='test'
      playerRef={ref}
    />
  );
  await act(async () => {
    finish({ ok: true, json: async () => ({ type: 'm3u8' }) });
  });
  expect(mockPlayers).toHaveLength(1);
  expect(mockHls[0].loadSource.mock.calls[0][0]).toContain(
    encodeURIComponent('https://media.test/new.m3u8')
  );
  global.fetch = original;
});

it('shows a finite startup timeout when no video data arrives', () => {
  jest.useFakeTimers();
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  act(() => jest.advanceTimersByTime(34000));
  expect(screen.getByRole('alert')).toHaveTextContent('连接超时');
});

it('reconnects native HLS network errors twice, then stops the stream', () => {
  jest.useFakeTimers();
  jest.spyOn(Hls, 'isSupported').mockReturnValue(false);
  jest
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockReturnValue('maybe');
  jest
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined);
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  Object.defineProperty(mockPlayers[0].video, 'error', { value: { code: 2 } });
  for (let count = 0; count < 3; count++)
    act(() => {
      mockPlayers[0].events['video:error']();
      jest.advanceTimersByTime(3000);
    });
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(3);
  expect(mockPlayers[0].video.hasAttribute('src')).toBe(false);
  expect(screen.getByRole('alert')).toBeVisible();
});

it('continues to HLS playback when an extensionless precheck fails', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  render(
    <LivePlayer
      url='https://media.test/channel'
      source='test'
      playerRef={{ current: null }}
    />
  );
  await act(async () => undefined);
  expect(mockHls).toHaveLength(1);
  expect(mockHls[0].loadSource).toHaveBeenCalled();
  global.fetch = original;
});

it('waits for a useful initial buffer and then starts without repeatedly recreating the player', () => {
  jest.useFakeTimers();
  const view = render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  mockHls[0].latestLevelDetails = {
    live: true,
    targetduration: 5,
    totalduration: 15,
  };
  let end = 4;
  Object.defineProperty(mockPlayers[0].video, 'buffered', {
    value: { length: 1, start: () => 0, end: () => end },
  });
  act(() => {
    mockPlayers[0].events['video:canplay']();
    jest.advanceTimersByTime(1000);
  });
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  end = 12;
  act(() => jest.advanceTimersByTime(300));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  expect(mockPlayers).toHaveLength(1);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('never waits indefinitely if the initial live buffer cannot grow', () => {
  jest.useFakeTimers();
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  mockHls[0].latestLevelDetails = {
    live: true,
    targetduration: 5,
    totalduration: 15,
  };
  act(() => {
    mockPlayers[0].events['video:canplay']();
    jest.advanceTimersByTime(6500);
  });
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});

it('avoids flashing a loading mask for a brief stall and keeps a small indicator for longer buffering', () => {
  jest.useFakeTimers();
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
    />
  );
  Object.defineProperty(mockPlayers[0].video, 'paused', { value: false });
  Object.defineProperty(mockPlayers[0].video, 'readyState', { value: 2 });
  act(() => mockPlayers[0].events['video:playing']());
  act(() => {
    mockPlayers[0].events['video:waiting']();
    jest.advanceTimersByTime(400);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => mockPlayers[0].events['video:timeupdate']());
  act(() => jest.advanceTimersByTime(500));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => {
    mockPlayers[0].events['video:waiting']();
    jest.advanceTimersByTime(750);
  });
  expect(screen.getByRole('status')).toHaveTextContent('正在缓冲');
  expect(screen.getByRole('status')).not.toHaveClass('inset-0');
});

it.each([false, true])(
  'tries an alternative after repeated sustained stalls and stops only when a replacement exists: %p',
  (alternative) => {
    jest.useFakeTimers();
    const onUnavailable = jest.fn().mockReturnValue(alternative);
    render(
      <LivePlayer
        url='https://media.test/live.m3u8'
        source='test'
        playerRef={{ current: null }}
        onUnavailable={onUnavailable}
      />
    );
    Object.defineProperty(mockPlayers[0].video, 'paused', { value: false });
    Object.defineProperty(mockPlayers[0].video, 'readyState', { value: 2 });
    act(() => mockPlayers[0].events['video:playing']());
    for (let count = 0; count < 3; count++)
      act(() => {
        mockPlayers[0].events['video:waiting']();
        jest.advanceTimersByTime(1600);
        mockPlayers[0].events['video:playing']();
      });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(mockHls[0].stopLoad).toHaveBeenCalledTimes(alternative ? 1 : 0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
);

it('does not restart or seek a healthy stream during sustained viewing', () => {
  jest.useFakeTimers();
  const onUnavailable = jest.fn();
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
      onUnavailable={onUnavailable}
    />
  );
  Object.defineProperty(mockPlayers[0].video, 'paused', { value: false });
  Object.defineProperty(mockPlayers[0].video, 'readyState', { value: 4 });
  act(() => mockPlayers[0].events['video:playing']());
  for (let time = 6; time <= 120; time += 6)
    act(() => {
      jest.advanceTimersByTime(6000);
      mockPlayers[0].video.currentTime = time;
      mockPlayers[0].events['video:timeupdate']();
    });
  expect(mockHls[0].startLoad).not.toHaveBeenCalled();
  expect(mockHls[0].recoverMediaError).not.toHaveBeenCalled();
  expect(onUnavailable).not.toHaveBeenCalled();
  expect(mockPlayers).toHaveLength(1);
});

it('does not count time spent paused by the viewer as a sustained network stall', () => {
  jest.useFakeTimers();
  const onUnavailable = jest.fn().mockReturnValue(true);
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
      onUnavailable={onUnavailable}
    />
  );
  let paused = false;
  Object.defineProperty(mockPlayers[0].video, 'paused', { get: () => paused });
  Object.defineProperty(mockPlayers[0].video, 'readyState', { value: 2 });
  act(() => mockPlayers[0].events['video:playing']());
  for (let count = 0; count < 3; count++)
    act(() => {
      mockPlayers[0].events['video:waiting']();
      jest.advanceTimersByTime(400);
      paused = true;
      mockPlayers[0].events['video:pause']();
      jest.advanceTimersByTime(5000);
      paused = false;
      mockPlayers[0].events['video:playing']();
    });
  expect(onUnavailable).not.toHaveBeenCalled();
  expect(mockHls[0].stopLoad).not.toHaveBeenCalled();
});

it('starts a fresh timeline for a reset source and bounds repeated automatic restarts', () => {
  const factory = playlists.livePlaylistLoader as jest.MockedFunction<
    typeof playlists.livePlaylistLoader
  >;
  const onUnavailable = jest.fn().mockReturnValue(false);
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
      onUnavailable={onUnavailable}
    />
  );
  act(() => factory.mock.calls[0][1]());
  expect(mockHls).toHaveLength(2);
  expect(mockHls[0].destroy).toHaveBeenCalledTimes(1);
  act(() => factory.mock.calls[1][1]());
  expect(mockHls).toHaveLength(2);
  expect(screen.getByRole('alert')).toHaveTextContent('播放列表反复异常');
  expect(onUnavailable).toHaveBeenCalledTimes(1);
});

it('reopens the original entry when a resolved playlist expires, with bounded recovery', () => {
  jest.useFakeTimers();
  const onUnavailable = jest.fn().mockReturnValue(false);
  render(
    <LivePlayer
      url='https://media.test/live.m3u8'
      source='test'
      playerRef={{ current: null }}
      onUnavailable={onUnavailable}
    />
  );
  const failure = {
    fatal: true,
    type: 'networkError',
    context: {
      url:
        'https://tv.test/api/proxy/m3u8?' +
        new URLSearchParams({ url: 'https://cdn.test/expired.m3u8?key=old' }),
    },
  };
  act(() => mockHls[0].error('error', failure));
  expect(mockHls).toHaveLength(2);
  expect(mockHls[0].destroy).toHaveBeenCalledTimes(1);
  expect(mockHls[1].loadSource.mock.calls[0][0]).toContain(
    encodeURIComponent('https://media.test/live.m3u8')
  );
  for (let count = 0; count < 3; count++)
    act(() => {
      mockHls[1].error('error', failure);
      jest.advanceTimersByTime(3000);
    });
  expect(mockHls).toHaveLength(2);
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toBeVisible();
});
