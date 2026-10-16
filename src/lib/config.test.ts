/** @jest-environment node */
jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn().mockResolvedValue(null),
    getAllUsers: jest.fn().mockResolvedValue([]),
    saveAdminConfig: jest.fn(),
  },
}));

import { AdminConfig } from './admin.types';
import { configSelfCheck, getConfig } from './config';
import { db } from './db';

it('does not write defaults when public requests or cold starts read config', async () => {
  const [first, second] = await Promise.all([getConfig(), getConfig()]);
  expect(first.SiteConfig).toBeDefined();
  expect(second.SiteConfig).toBeDefined();
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
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
