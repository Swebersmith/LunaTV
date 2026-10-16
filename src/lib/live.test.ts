/** @jest-environment node */
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));

import { runInThisContext } from 'vm';

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import {
  deleteCachedLiveChannels,
  getCachedLiveChannels,
  getLiveEpg,
  parseM3U,
} from './live';

Object.assign(
  global,
  runInThisContext(
    '({ Response, Request, Headers, ReadableStream, TextEncoder, TextDecoder })'
  )
);
const originalFetch = global.fetch;
const source = {
  key: 'live-cache',
  name: '直播',
  url: 'https://old.test/list',
  from: 'custom' as const,
  channelNumber: 0,
};
beforeEach(() => {
  deleteCachedLiveChannels(source.key);
  global.fetch = jest
    .fn()
    .mockImplementation(
      () =>
        new Response('#EXTM3U\n#EXTINF:-1,频道\nhttps://video.test/play.m3u8')
    );
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('loads channels without writing an older configuration back to storage', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  expect((await getCachedLiveChannels(source.key))?.channelNumber).toBe(1);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(source.channelNumber).toBe(0);
});

it('checks the latest disabled state and refetches edited addresses before serving cached channels', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  await getCachedLiveChannels(source.key);
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ ...source, url: 'https://new.test/list' }],
  } as AdminConfig);
  await getCachedLiveChannels(source.key);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith(
    'https://new.test/list',
    expect.anything()
  );
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ ...source, disabled: true }],
  } as AdminConfig);
  expect(await getCachedLiveChannels(source.key)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('resolves relative channels, logos and programme guides after redirects and skips IPTV option tags', () => {
  const result = parseM3U(
    'tv',
    '#EXTM3U x-tvg-url="guide.xml"\n#EXTINF:-1 tvg-logo="logos/tv.png",频道\n#EXTVLCOPT:http-user-agent=Player\nstreams/main.m3u8',
    'https://cdn.test/final/list'
  );
  expect(result.tvgUrl).toBe('https://cdn.test/final/guide.xml');
  expect(result.channels[0].url).toBe(
    'https://cdn.test/final/streams/main.m3u8'
  );
  expect(result.channels[0].logo).toBe('https://cdn.test/final/logos/tv.png');
});

it('keeps optional EPG loading off the channel path and parses compact XML separately', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input).includes('guide.xml')
            ? '<tv><programme channel="channel" start="20261017080000 +0800" stop="20261017090000 +0800"><title lang="zh">新闻 &amp; 天气</title></programme></tv>'
            : '#EXTM3U x-tvg-url="https://old.test/guide.xml"\n#EXTINF:-1 tvg-id="channel",频道\nhttps://media.test/live.m3u8'
        )
    );
  const channels = await getCachedLiveChannels(source.key);
  expect(channels?.channelNumber).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await getLiveEpg(source.key))?.epgs.channel[0].title).toBe(
    '新闻 & 天气'
  );
  await getLiveEpg(source.key);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('expires playlist caches and allows an explicit refresh without database writes', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  await getCachedLiveChannels(source.key);
  await getCachedLiveChannels(source.key);
  expect(fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1000000 + 5 * 60 * 1000 + 1);
  await getCachedLiveChannels(source.key);
  expect(fetch).toHaveBeenCalledTimes(2);
  await getCachedLiveChannels(source.key, true);
  expect(fetch).toHaveBeenCalledTimes(3);
  now.mockRestore();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
