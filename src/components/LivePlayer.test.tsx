/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen } from '@testing-library/react';
import Hls from 'hls.js';

import LivePlayer from './LivePlayer';

const mockPlayers: any[] = [];
const mockHls: any[] = [];
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
  mockPlayers.length = 0;
  mockHls.length = 0;
  jest
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
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
  jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  render(<LivePlayer url='https://media.test/live.m3u8' source='test' playerRef={{ current: null }} />);
  Object.defineProperty(mockPlayers[0].video, 'error', { value: { code: 2 } });
  for (let count = 0; count < 3; count++) act(() => { mockPlayers[0].events['video:error'](); jest.advanceTimersByTime(3000); });
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(3);
  expect(mockPlayers[0].video.hasAttribute('src')).toBe(false);
  expect(screen.getByRole('alert')).toBeVisible();
});

it('continues to HLS playback when an extensionless precheck fails', async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  render(<LivePlayer url='https://media.test/channel' source='test' playerRef={{ current: null }} />);
  await act(async () => undefined);
  expect(mockHls).toHaveLength(1);
  expect(mockHls[0].loadSource).toHaveBeenCalled();
  global.fetch = original;
});
