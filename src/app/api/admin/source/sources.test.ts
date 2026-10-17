/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      options?: { status?: number; headers?: unknown }
    ) => ({ body, status: options?.status ?? 200, headers: options?.headers }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));
jest.mock('@/lib/live', () => ({
  deleteCachedLiveChannels: jest.fn(),
  refreshLiveChannels: jest.fn(),
}));
jest.mock('@/lib/storage-type', () => ({
  getStorageType: () => 'cloudflare-d1',
}));

import { NextRequest } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { deleteCachedLiveChannels, refreshLiveChannels } from '@/lib/live';

import { POST as video } from './route';
import { POST as epg } from '../epg/route';
import { POST as live } from '../live/route';

const request = (body: unknown) => ({ json: async () => body } as NextRequest);
type ResponseResult = {
  status: number;
  body: { sources: Record<string, unknown>[]; needsRefresh?: boolean };
};
const send = async (
  handler: (request: NextRequest) => Promise<unknown>,
  body: unknown
) => (await handler(request(body))) as ResponseResult;
const originalUsername = process.env.USERNAME;
const videoInput = {
  key: 'vod',
  name: '新名称',
  api: 'https://new.example.test/api?token=keep',
  detail: '',
  note: '高清\n晚高峰备用',
};
const liveInput = {
  key: 'tv',
  name: '直播',
  url: 'https://live.example.test/list.m3u',
  ua: '',
  epg: '',
  note: '家庭直播线路',
};
let original: AdminConfig;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME = 'test-owner';
  jest
    .mocked(getAuthInfoFromCookie)
    .mockReturnValue({ username: 'test-owner' });
  original = {
    ConfigFile: '{}',
    UserConfig: {
      Users: [{ username: 'member', role: 'user', enabledApis: ['vod'] }],
    },
    SourceConfig: [
      {
        key: 'vod',
        name: '旧名称',
        api: 'https://old.example.test/api',
        from: 'config',
        disabled: true,
      },
    ],
    LiveConfig: [
      {
        ...liveInput,
        note: '旧备注',
        from: 'config',
        channelNumber: 10,
        disabled: false,
      },
    ],
  } as AdminConfig;
  jest.mocked(getConfig).mockResolvedValue(original);
  jest.mocked(db.saveAdminConfig).mockResolvedValue(undefined);
});

afterAll(() => {
  if (originalUsername === undefined) delete process.env.USERNAME;
  else process.env.USERNAME = originalUsername;
});

it('edits imported video sources and notes without changing identity, disabled state, or permissions', async () => {
  const result = await send(video, { action: 'edit', ...videoInput });
  expect(result.status).toBe(200);
  expect(result.body.sources[0]).toMatchObject({
    ...videoInput,
    from: 'config',
    overridden: true,
    disabled: true,
  });
  expect(db.saveAdminConfig).toHaveBeenCalledTimes(1);
  expect(jest.mocked(db.saveAdminConfig).mock.calls[0][0].UserConfig).toEqual(
    original.UserConfig
  );
  expect(original.SourceConfig[0].name).toBe('旧名称');
});

it('saves live notes immediately without downloading playlists or changing the channel count', async () => {
  const result = await send(live, { action: 'edit', ...liveInput });
  expect(result.status).toBe(200);
  expect(result.body.needsRefresh).toBe(false);
  expect(result.body.sources[0]).toMatchObject({
    note: liveInput.note,
    channelNumber: 10,
    from: 'config',
    overridden: true,
  });
  expect(refreshLiveChannels).not.toHaveBeenCalled();
  expect(deleteCachedLiveChannels).not.toHaveBeenCalled();
});

it('invalidates a live playlist only after a changed address is saved', async () => {
  const result = await send(live, {
    action: 'edit',
    ...liveInput,
    url: 'https://new.example.test/list.m3u',
  });
  expect(result.body.needsRefresh).toBe(true);
  expect(result.body.sources[0].channelNumber).toBe(0);
  expect(deleteCachedLiveChannels).toHaveBeenCalledWith('tv');
  expect(refreshLiveChannels).not.toHaveBeenCalled();
});

it.each([
  [video, 'vod'],
  [live, 'tv'],
] as const)(
  'returns committed disabled state and leaves old snapshots untouched',
  async (handler, key) => {
    const result = await send(handler, { action: 'disable', key });
    expect(result.status).toBe(200);
    expect(result.body.sources[0].disabled).toBe(true);
    expect(original.LiveConfig?.[0].disabled).toBe(false);
  }
);

it.each([
  {},
  { api: 'javascript:alert(1)' },
  { name: '  ' },
  { note: { unexpected: true } },
])('rejects invalid video input before saving: %p', async (invalid) => {
  const result = await send(video, {
    action: 'add',
    ...(Object.keys(invalid).length ? videoInput : {}),
    ...invalid,
  });
  expect(result.status).toBe(400);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

it.each([
  [video, { action: 'enable', key: 'vod' }],
  [
    live,
    { action: 'edit', ...liveInput, url: 'https://changed.example.test/list' },
  ],
] as const)(
  'does not expose unsaved mutations when storage fails',
  async (handler, body) => {
    const before = JSON.stringify(original);
    jest
      .mocked(db.saveAdminConfig)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    expect((await send(handler, body)).status).toBe(500);
    expect(JSON.stringify(original)).toBe(before);
    expect(deleteCachedLiveChannels).not.toHaveBeenCalled();
  }
);

it.each([video, live, epg])(
  'rejects an unauthenticated or non-admin caller',
  async (handler) => {
    jest.mocked(getAuthInfoFromCookie).mockReturnValue(null);
    expect(
      (await send(handler, { action: 'disable', key: 'vod' })).status
    ).toBe(401);
    jest.mocked(getAuthInfoFromCookie).mockReturnValue({ username: 'member' });
    expect(
      (await send(handler, { action: 'disable', key: 'vod' })).status
    ).toBe(401);
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
  }
);

it('adds a reusable EPG source without downloading a playlist or replacing other configuration', async () => {
  const input = {
    key: 'guide',
    name: '节目单',
    url: 'https://guide.test/epg.xml.gz',
    ua: 'Guide/1.0',
    note: '公共节目单',
  };
  const result = await send(epg, { action: 'add', ...input });
  expect(result.status).toBe(200);
  expect(result.body.sources).toEqual([{ ...input, disabled: false }]);
  expect(jest.mocked(db.saveAdminConfig).mock.calls[0][0].LiveConfig).toEqual(
    original.LiveConfig
  );
  expect(original.EpgConfig).toBeUndefined();
  expect(refreshLiveChannels).not.toHaveBeenCalled();
});

it('preserves EPG disabled state when editing and saves priority, enable and delete operations', async () => {
  original.EpgConfig = [
    { key: 'a', name: 'A', url: 'https://a.test/guide.xml', disabled: true },
    { key: 'b', name: 'B', url: 'https://b.test/guide.xml' },
  ];
  const edited = await send(epg, {
    action: 'edit',
    key: 'a',
    name: '新名称',
    url: 'https://a.test/new.xml',
    note: '备注',
  });
  expect(edited.body.sources[0]).toMatchObject({
    name: '新名称',
    note: '备注',
    disabled: true,
  });
  expect(
    (await send(epg, { action: 'sort', order: ['b', 'a'] })).body.sources.map(
      (source) => source.key
    )
  ).toEqual(['b', 'a']);
  expect(
    (await send(epg, { action: 'enable', key: 'a' })).body.sources[0].disabled
  ).toBe(false);
  expect(
    (await send(epg, { action: 'delete', key: 'a' })).body.sources.map(
      (source) => source.key
    )
  ).toEqual(['b']);
  expect(original.EpgConfig[0].disabled).toBe(true);
});

it.each([
  null,
  { action: 'add', key: 'a', name: 'A', url: 'javascript:alert(1)' },
  { action: 'sort', order: ['a', 'a'] },
])('rejects invalid guide configuration before writing: %p', async (input) => {
  expect((await send(epg, input)).status).toBe(400);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

it('keeps EPG edits private until persistence succeeds', async () => {
  original.EpgConfig = [
    { key: 'a', name: 'A', url: 'https://a.test/guide.xml' },
  ];
  jest
    .mocked(db.saveAdminConfig)
    .mockRejectedValueOnce(new Error('unavailable'));
  expect((await send(epg, { action: 'disable', key: 'a' })).status).toBe(500);
  expect(original.EpgConfig[0].disabled).toBeUndefined();
});
