import { parseBackup } from './backup';

it('validates every user before allowing a backup restore', () => {
  const valid = {
    adminConfig: { SiteConfig: { SiteName: 'example' } },
    userData: {
      alice: {
        password: 'hash',
        searchHistory: ['movie'],
        skipConfigs: {
          'source+id+part': { enable: true, intro_time: 10, outro_time: 20 },
        },
      },
    },
  };
  expect(parseBackup(valid)).toEqual(valid);
  expect(() =>
    parseBackup({
      ...valid,
      userData: { alice: { playRecords: { 's+1': 'broken' } } },
    })
  ).toThrow();
  expect(() =>
    parseBackup({
      ...valid,
      userData: {
        alice: {
          skipConfigs: {
            broken: { enable: true, intro_time: 1, outro_time: 1 },
          },
        },
      },
    })
  ).toThrow();
  expect(() =>
    parseBackup({ ...valid, userData: { alice: { searchHistory: [42] } } })
  ).toThrow();
});

it('preserves independent EPG sources, ordering and notes through backup validation', () => {
  const backup = {
    adminConfig: {
      SiteConfig: { SiteName: 'CrayonTV' },
      EpgConfig: [
        {
          key: 'guide',
          name: '节目单',
          url: 'https://guide.test/epg.xml',
          note: '备注',
          disabled: true,
        },
      ],
    },
    userData: {},
  };
  expect(parseBackup(backup)).toEqual(backup);
});
