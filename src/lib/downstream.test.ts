/** @jest-environment node */
jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} }, detail: { headers: {} } },
  getConfig: jest.fn(),
}));
jest.mock('@/lib/utils', () => ({ cleanHtmlTags: (value: string) => value }));

import { searchFromApi, searchPageFromApi } from './downstream';

const originalFetch = global.fetch;
const payload = (id: string, pages = 1) =>
  ({
    ok: true,
    json: async () => ({
      pagecount: pages,
      list: [
        {
          vod_id: id,
          vod_name: id,
          vod_pic: '',
          vod_year: '2026',
          vod_play_url: '正片$https://video.example.test/play.m3u8?token=keep',
        },
      ],
    }),
  } as Response);
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it('preserves existing API query parameters and signed m3u8 playback URLs', async () => {
  jest.mocked(fetch).mockResolvedValue(payload('signed'));
  const result = await searchPageFromApi(
    {
      key: 'signed',
      name: '源',
      api: 'https://example.test/api?token=secret-test',
    },
    '小新',
    2
  );
  const url = new URL(String(jest.mocked(fetch).mock.calls[0][0]));
  expect(url.searchParams.get('token')).toBe('secret-test');
  expect(url.searchParams.get('wd')).toBe('小新');
  expect(url.searchParams.get('pg')).toBe('2');
  expect(result.results[0].episodes).toEqual([
    'https://video.example.test/play.m3u8?token=keep',
  ]);
});

it('does not reuse a source cache after its API URL or display name changes', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(payload('old'))
    .mockResolvedValueOnce(payload('new'))
    .mockResolvedValueOnce(payload('renamed'));
  const source = { key: 'edited', name: '原名', api: 'https://old.test/api' };
  await searchPageFromApi(source, '小新', 1);
  const changed = { ...source, api: 'https://new.test/api' };
  expect((await searchPageFromApi(changed, '小新', 1)).results[0].id).toBe(
    'new'
  );
  expect(
    (await searchPageFromApi({ ...changed, name: '新名称' }, '小新', 1))
      .results[0].source_name
  ).toBe('新名称');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('does not append pagination results into the cached first page on repeated searches', async () => {
  jest
    .mocked(fetch)
    .mockImplementation(async (input) =>
      payload(new URL(String(input)).searchParams.get('pg') || '1', 2)
    );
  const source = { key: 'pages', name: '源', api: 'https://pages.test/api' };
  expect(
    (await searchFromApi(source, '小新', 2)).map((item) => item.id)
  ).toEqual(['1', '2']);
  expect(
    (await searchFromApi(source, '小新', 2)).map((item) => item.id)
  ).toEqual(['1', '2']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries a temporarily rejected provider after ten seconds instead of caching failure for ten minutes', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    .mockResolvedValueOnce(payload('recovered'));
  const source = {
    key: 'temporarily-down',
    name: '源',
    api: 'https://recover.test/api',
  };
  expect((await searchPageFromApi(source, '小新', 1)).failed).toBe(true);
  jest.advanceTimersByTime(10001);
  expect((await searchPageFromApi(source, '小新', 1)).results[0].id).toBe(
    'recovered'
  );
});
