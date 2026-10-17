import {
  beijingEpgDate,
  diypChannelNames,
  diypEpgUrl,
  isDiypEpg,
  parseDiypPrograms,
} from './live-epg';

it('detects DIYP endpoints and updates channel/date without dropping other query parameters', () => {
  expect(isDiypEpg('https://epg.test/api/diyp/')).toBe(true);
  expect(isDiypEpg('https://epg.test/epg.php?ch=old')).toBe(true);
  expect(isDiypEpg('https://epg.test/tv.xml.gz')).toBe(false);
  expect(isDiypEpg('https://epg.test/tv.xml?ch=CCTV1')).toBe(false);
  const url = new URL(
    diypEpgUrl(
      'https://epg.test/api/diyp/?key=a%2Fb&ch=old&date=old',
      'CCTV5+',
      '2026-10-17'
    )
  );
  expect(url.searchParams.get('key')).toBe('a/b');
  expect(url.searchParams.get('ch')).toBe('CCTV5+');
  expect(url.searchParams.get('date')).toBe('2026-10-17');
});

it('uses the Beijing date at the day boundary and normalizes station names rather than resolutions', () => {
  expect(beijingEpgDate(Date.parse('2026-10-17T15:59:59Z'))).toBe('2026-10-17');
  expect(beijingEpgDate(Date.parse('2026-10-17T16:00:00Z'))).toBe('2026-10-18');
  expect(diypChannelNames({ name: 'CCTV-1(720p)', tvgId: 'cctv1' })).toEqual([
    'CCTV1',
  ]);
  expect(
    diypChannelNames({ name: 'CCTV-5+体育赛事', tvgId: 'sports' })
  ).toEqual(['CCTV5+', 'sports']);
  expect(diypChannelNames({ name: '湖南卫视（高清）', tvgId: '' })).toEqual([
    '湖南卫视',
  ]);
});

it('converts DIYP wall times with explicit Beijing timezone, including midnight, and rejects stale/fake data', () => {
  const data = {
    channel_name: 'CCTV-1综合',
    date: '2026-10-17',
    epg_data: [
      { start: '19:00', end: '19:30', title: '晚间新闻' },
      { start: '23:50', end: '00:30', title: '跨天节目' },
      { start: '23:00', end: '24:00', title: '午夜结束' },
      { start: '25:00', end: '26:00', title: '无效' },
      { start: '00:00', end: '00:59', title: '精彩节目-暂未提供节目预告信息' },
    ],
  };
  expect(parseDiypPrograms(data, '2026-10-17')).toEqual([
    {
      start: '2026-10-17T11:00:00.000Z',
      end: '2026-10-17T11:30:00.000Z',
      title: '晚间新闻',
    },
    {
      start: '2026-10-17T15:50:00.000Z',
      end: '2026-10-17T16:30:00.000Z',
      title: '跨天节目',
    },
    {
      start: '2026-10-17T15:00:00.000Z',
      end: '2026-10-17T16:00:00.000Z',
      title: '午夜结束',
    },
  ]);
  expect(parseDiypPrograms(data, '2026-10-18')).toEqual([]);
  expect(
    parseDiypPrograms({ ...data, channel_name: '未提供' }, '2026-10-17')
  ).toEqual([]);
  expect(
    parseDiypPrograms({ epg_data: [null, 'bad', { title: 3 }] }, '2026-10-17')
  ).toEqual([]);
});
