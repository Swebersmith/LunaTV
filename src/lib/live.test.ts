/** @jest-environment node */
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { deleteCachedLiveChannels, getCachedLiveChannels } from './live';

const originalFetch = global.fetch;
const source = { key: 'live-cache', name: '直播', url: 'https://old.test/list', from: 'custom' as const, channelNumber: 0 };
beforeEach(() => { deleteCachedLiveChannels(source.key); global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '#EXTM3U\n#EXTINF:-1,频道\nhttps://video.test/play.m3u8' }); });
afterEach(() => { global.fetch = originalFetch; });

it('loads channels without writing an older configuration back to storage', async () => {
  jest.mocked(getConfig).mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  expect((await getCachedLiveChannels(source.key))?.channelNumber).toBe(1);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
  expect(source.channelNumber).toBe(0);
});

it('checks the latest disabled state and refetches edited addresses before serving cached channels', async () => {
  jest.mocked(getConfig).mockResolvedValue({ LiveConfig: [source] } as AdminConfig);
  await getCachedLiveChannels(source.key);
  jest.mocked(getConfig).mockResolvedValue({ LiveConfig: [{ ...source, url: 'https://new.test/list' }] } as AdminConfig);
  await getCachedLiveChannels(source.key);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith('https://new.test/list', expect.anything());
  jest.mocked(getConfig).mockResolvedValue({ LiveConfig: [{ ...source, disabled: true }] } as AdminConfig);
  expect(await getCachedLiveChannels(source.key)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});
