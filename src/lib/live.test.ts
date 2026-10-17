/** @jest-environment node */
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));

import { runInThisContext } from 'vm';
import { gzipSync } from 'zlib';

import { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import {
  deleteCachedLiveChannels,
  getCachedLiveChannels,
  getLiveEpg,
  parseM3U,
} from './live';
import { beijingEpgDate } from './live-epg';

Object.assign(
  global,
  runInThisContext(
    '({ Response, Request, Headers, ReadableStream, TextEncoder, TextDecoder, DecompressionStream })'
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

it('uses shared guides without an M3U guide and skips disabled sources', async () => {
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [source],
    EpgConfig: [
      {
        key: 'off',
        name: '禁用',
        url: 'https://off.test/guide',
        disabled: true,
      },
      {
        key: 'shared',
        name: '共享',
        url: 'https://shared.test/guide',
        ua: 'Guide/1.0',
      },
    ],
  } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input).includes('shared.test')
            ? '<tv><programme channel="one" start="20261017080000 +0800" stop="20261017090000 +0800"><title>节目</title></programme></tv>'
            : '#EXTM3U\n#EXTINF:-1 tvg-id="one",频道\nhttps://media.test/play.m3u8'
        )
    );
  expect((await getLiveEpg(source.key, 'one'))?.epgs.one[0].title).toBe('节目');
  expect(jest.mocked(fetch).mock.calls.map((call) => String(call[0]))).toEqual([
    source.url,
    'https://shared.test/guide',
  ]);
  expect(
    new Headers(jest.mocked(fetch).mock.calls[1][1]?.headers).get('user-agent')
  ).toBe('Guide/1.0');
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

it('prioritizes a live-specific guide and supplements missing stations from shared guides', async () => {
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ ...source, epg: 'https://specific.test/guide' }],
    EpgConfig: [
      { key: 'shared', name: '共享', url: 'https://shared.test/guide' },
    ],
  } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input).includes('specific.test')
            ? '<tv><programme channel="one" start="20261017080000 +0800" stop="20261017090000 +0800"><title>优先节目</title></programme></tv>'
            : String(input).includes('shared.test')
            ? '<tv><programme channel="one" start="20261017080000 +0800" stop="20261017090000 +0800"><title>替代节目</title></programme><programme channel="two" start="20261017080000 +0800" stop="20261017090000 +0800"><title>第二频道</title></programme></tv>'
            : '#EXTM3U\n#EXTINF:-1 tvg-id="one",频道一\nhttps://media.test/1.m3u8\n#EXTINF:-1 tvg-id="two",频道二\nhttps://media.test/2.m3u8'
        )
    );
  const result = await getLiveEpg(source.key);
  expect(result?.epgs.one[0].title).toBe('优先节目');
  expect(result?.epgs.two[0].title).toBe('第二频道');
});

it('detects gzip bytes across chunks, parses CDATA, and invalidates cached programmes after an edit or disable', async () => {
  const guides = [
    { key: 'guide', name: '节目单', url: 'https://guide.test/a.xml.gz' },
  ];
  jest
    .mocked(getConfig)
    .mockImplementation(
      async () => ({ LiveConfig: [source], EpgConfig: guides } as AdminConfig)
    );
  jest.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) === source.url)
      return new Response(
        '#EXTM3U\n#EXTINF:-1 tvg-id="one",频道\nhttps://media.test/live.m3u8'
      );
    const title = String(input).includes('/a.') ? '第一版 & <原文>' : '第二版';
    const compressed = gzipSync(
      `<tv><programme channel="one" start="20261017080000 +0800" stop="20261017090000 +0800"><title><![CDATA[${title}]]></title></programme></tv>`
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(compressed.subarray(0, 1));
          controller.enqueue(compressed.subarray(1));
          controller.close();
        },
      })
    );
  });
  expect((await getLiveEpg(source.key, 'one'))?.epgs.one[0].title).toBe(
    '第一版 & <原文>'
  );
  await getLiveEpg(source.key, 'one');
  expect(fetch).toHaveBeenCalledTimes(2);
  guides[0].url = 'https://guide.test/b.xml.gz';
  expect((await getLiveEpg(source.key, 'one'))?.epgs.one[0].title).toBe(
    '第二版'
  );
  Object.assign(guides[0], { disabled: true });
  expect((await getLiveEpg(source.key, 'one'))?.epgs).toEqual({});
});

it('falls back to an M3U guide when both a live override and shared guide fail', async () => {
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [{ ...source, epg: 'https://bad.test/specific' }],
    EpgConfig: [{ key: 'bad', name: '失效', url: 'https://bad.test/guide' }],
  } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(async (input) =>
      String(input).includes('bad.test')
        ? new Response('offline', { status: 503 })
        : new Response(
            String(input).includes('m3u-guide')
              ? '<tv><programme channel="one" start="20261017080000 +0800" stop="20261017090000 +0800"><title>兜底节目</title></programme></tv>'
              : '#EXTM3U x-tvg-url="https://old.test/m3u-guide"\n#EXTINF:-1 tvg-id="one",频道\nhttps://media.test/live.m3u8'
          )
    );
  expect((await getLiveEpg(source.key, 'one'))?.epgs.one[0].title).toBe(
    '兜底节目'
  );
});

it('cancels a stalled guide within the total request budget without affecting cached channels', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  jest.mocked(getConfig).mockResolvedValue({
    LiveConfig: [source],
    EpgConfig: [
      { key: 'slow', name: '慢节目单', url: 'https://slow.test/guide' },
    ],
  } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input) === source.url
            ? '#EXTM3U\n#EXTINF:-1 tvg-id="one",频道\nhttps://media.test/live.m3u8'
            : new ReadableStream({ cancel })
        )
    );
  try {
    const pending = getLiveEpg(source.key, 'one');
    for (let i = 0; i < 30; i++) await Promise.resolve();
    jest.advanceTimersByTime(12001);
    expect((await pending)?.epgs).toEqual({});
    expect(cancel).toHaveBeenCalled();
    expect((await getCachedLiveChannels(source.key))?.channelNumber).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

it('queries a DIYP base address for the current station/day, caches data and never writes storage', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({
      LiveConfig: [source],
      EpgConfig: [
        {
          key: 'json',
          name: 'JSON',
          url: 'https://epg.test/api/diyp/?key=secret',
        },
      ],
    } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input) === source.url
            ? '#EXTM3U\n#EXTINF:-1 tvg-id="opaque-123",CCTV-1(720p)\nhttps://media.test/live.m3u8'
            : JSON.stringify({
                channel_name: 'CCTV-1综合',
                date: beijingEpgDate(),
                epg_data: [{ start: '19:00', end: '19:30', title: '新闻' }],
              })
        )
    );
  const guide = await getLiveEpg(source.key, 'opaque-123');
  expect(guide?.epgs['opaque-123'][0].title).toBe('新闻');
  const request = new URL(String(jest.mocked(fetch).mock.calls[1][0]));
  expect(request.searchParams.get('ch')).toBe('CCTV1');
  expect(request.searchParams.get('date')).toBe(beijingEpgDate());
  expect(request.searchParams.get('key')).toBe('secret');
  await getLiveEpg(source.key, 'opaque-123');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

it('finds DIYP programmes by channel name when the M3U has no tvg-id', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({
      LiveConfig: [source],
      EpgConfig: [
        { key: 'json', name: 'JSON', url: 'https://epg.test/api/diyp/' },
      ],
    } as AdminConfig);
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input) === source.url
            ? '#EXTM3U\n#EXTINF:-1,CCTV-1(720p)\nhttps://media.test/live.m3u8'
            : JSON.stringify({
                date: beijingEpgDate(),
                epg_data: [
                  { start: '19:00', end: '19:30', title: '无标识频道节目' },
                ],
              })
        )
    );
  const guide = await getLiveEpg(source.key, 'CCTV-1(720p)');
  expect(guide?.epgs['CCTV-1(720p)'][0].title).toBe('无标识频道节目');
  expect(
    new URL(String(jest.mocked(fetch).mock.calls[1][0])).searchParams.get('ch')
  ).toBe('CCTV1');
});

it('falls back from DIYP placeholder schedules to XMLTV and refreshes a cached API guide after Beijing midnight', async () => {
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-10-17T15:59:59Z'));
  const guides = [
    { key: 'json', name: 'JSON', url: 'https://epg.test/api/diyp/' },
    { key: 'xml', name: 'XML', url: 'https://epg.test/guide.xml' },
  ];
  jest
    .mocked(getConfig)
    .mockResolvedValue({
      LiveConfig: [source],
      EpgConfig: guides,
    } as AdminConfig);
  let placeholder = true;
  jest
    .mocked(fetch)
    .mockImplementation(
      async (input) =>
        new Response(
          String(input) === source.url
            ? '#EXTM3U\n#EXTINF:-1 tvg-id="CCTV1",CCTV1\nhttps://media.test/live.m3u8'
            : String(input).includes('guide.xml')
            ? '<tv><programme channel="CCTV1" start="20261017190000 +0800" stop="20261017193000 +0800"><title>XML兜底</title></programme></tv>'
            : JSON.stringify({
                date: beijingEpgDate(),
                epg_data: [
                  {
                    start: '19:00',
                    end: '19:30',
                    title: placeholder
                      ? '精彩节目-暂未提供节目预告信息'
                      : '新一天节目',
                  },
                ],
              })
        )
    );
  try {
    expect((await getLiveEpg(source.key, 'CCTV1'))?.epgs.CCTV1[0].title).toBe(
      'XML兜底'
    );
    placeholder = false;
    clock.mockReturnValue(Date.parse('2026-10-17T16:00:01Z'));
    expect((await getLiveEpg(source.key, 'CCTV1'))?.epgs.CCTV1[0].title).toBe(
      '新一天节目'
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally {
    clock.mockRestore();
  }
});
