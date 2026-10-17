/** @jest-environment node */
jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn().mockResolvedValue(null),
    getAllUsers: jest.fn().mockResolvedValue([]),
    saveAdminConfig: jest.fn(),
  },
}));

import { AdminConfig } from './admin.types';
import { configSelfCheck, getConfig, refineConfig } from './config';
import { db } from './db';

it('does not write defaults when public requests or cold starts read config', async () => {
  const [first, second] = await Promise.all([getConfig(), getConfig()]);
  expect(first.SiteConfig).toBeDefined();
  expect(second.SiteConfig).toBeDefined();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});

it('reads shared storage again so an older Worker cannot hide an edit or disable', async () => {
  const previousStorage = process.env.STORAGE_TYPE;
  process.env.STORAGE_TYPE = 'cloudflare-d1';
  try {
    jest.mocked(db.getAdminConfig).mockResolvedValueOnce({ SourceConfig: [{ key: 'vod', disabled: false }] } as AdminConfig).mockResolvedValueOnce({ SourceConfig: [{ key: 'vod', disabled: true, note: '已更新' }] } as AdminConfig);
    expect((await getConfig()).SourceConfig[0].disabled).toBe(false);
    expect((await getConfig()).SourceConfig[0]).toMatchObject({ disabled: true, note: '已更新' });
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
  } finally {
    if (previousStorage === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = previousStorage;
  }
});

it('keeps imported source overrides, notes, and disabled states through subscription refinement', () => {
  const config = { ConfigFile: JSON.stringify({ api_site: { vod: { name: '订阅名称', api: 'https://subscription.test' } }, lives: { tv: { name: '订阅直播', url: 'https://subscription.test/list' } } }), SourceConfig: [{ key: 'vod', name: '手动名称', api: 'https://manual.test', note: '手动备注', disabled: true, overridden: true, from: 'config' }], LiveConfig: [{ key: 'tv', name: '手动直播', url: 'https://manual.test/list', note: '直播备注', disabled: true, overridden: true, from: 'config' }], CustomCategories: [] } as unknown as AdminConfig;
  refineConfig(config);
  expect(config.SourceConfig[0]).toMatchObject({ name: '手动名称', api: 'https://manual.test', note: '手动备注', disabled: true });
  expect(config.LiveConfig?.[0]).toMatchObject({ name: '手动直播', url: 'https://manual.test/list', note: '直播备注', disabled: true });
});

it('normalizes older guide configurations without retaining malformed entries or losing valid notes', () => {
  const guide = { key: 'guide', name: '节目单', url: 'https://guide.test/xml', note: '每日更新', disabled: true };
  const config = { UserConfig: { Users: [] }, EpgConfig: [null, guide, { ...guide, name: '重复' }, { ...guide, key: 'bad', note: {} }] } as unknown as AdminConfig;
  expect(configSelfCheck(config).EpgConfig).toEqual([guide]);
});

describe('user configuration cleanup', () => {
  const originalUsername = process.env.USERNAME;

  afterEach(() => {
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
  });

  it('removes missing and whitespace usernames while preserving named users and their settings', () => {
    process.env.USERNAME = 'owner';
    const owner = {
      username: 'owner',
      role: 'owner',
      enabledApis: ['source-a'],
      tags: ['family'],
    };
    const member = {
      username: 'member',
      role: 'admin',
      banned: true,
      enabledApis: ['source-b'],
    };
    const config = {
      UserConfig: {
        Users: [
          null,
          {},
          { username: null },
          { username: '' },
          { username: ' \t ' },
          owner,
          member,
          { username: 'member', role: 'user' },
        ],
        Tags: [{ name: 'family', enabledApis: ['source-a'] }],
      },
    } as unknown as AdminConfig;

    expect(configSelfCheck(config).UserConfig).toEqual({
      Users: [{ ...owner, banned: false }, member],
      Tags: [{ name: 'family', enabledApis: ['source-a'] }],
    });
  });

  it.each([undefined, '', ' \t '])(
    'does not recreate a blank owner when USERNAME is %p',
    (username) => {
      if (username === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = username;
      const config = {
        UserConfig: {
          Users: [
            { username: '', role: 'owner' },
            { username: 'member', role: 'user', tags: ['family'] },
          ],
        },
      } as AdminConfig;

      expect(configSelfCheck(config).UserConfig.Users).toEqual([
        { username: 'member', role: 'user', tags: ['family'] },
      ]);
      expect(db.saveAdminConfig).not.toHaveBeenCalled();
    }
  );
});
