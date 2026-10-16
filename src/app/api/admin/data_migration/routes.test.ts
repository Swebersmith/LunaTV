/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    constructor(private body: string, options?: { status?: number }) {
      this.status = options?.status ?? 200;
    }
    async text() {
      return this.body;
    }
    static json(body: unknown, options?: { status?: number }) {
      return new this(JSON.stringify(body), options);
    }
  },
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => ({ username: 'owner' }),
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { SiteName: 'backup' } }),
  configSelfCheck: (config: unknown) => config,
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getAllUsers: jest.fn().mockResolvedValue(['alice']),
    getUserPassword: jest.fn().mockResolvedValue('stored-password-hash'),
    getAllPlayRecords: jest.fn().mockResolvedValue({}),
    getAllFavorites: jest.fn().mockResolvedValue({}),
    getSearchHistory: jest.fn().mockResolvedValue(['latest', 'older']),
    getAllSkipConfigs: jest.fn().mockResolvedValue({}),
    restoreBackup: jest.fn().mockResolvedValue(undefined),
  },
}));

import { gzipSync } from 'zlib';

import { setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

import { POST as exportBackup } from './export/route';
import { POST as importBackup } from './import/route';

describe('encrypted backup routes with D1-compatible storage methods', () => {
  const original = {
    username: process.env.USERNAME,
    storage: process.env.STORAGE_TYPE,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    process.env.STORAGE_TYPE = 'cloudflare-d1';
  });
  afterAll(() => {
    if (original.username === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = original.username;
    if (original.storage === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = original.storage;
  });
  const request = (data: string) =>
    ({
      formData: async () =>
        new Map([
          ['file', { text: async () => data }],
          ['password', 'backup-password'],
        ] as [string, unknown][]),
    } as never);

  it('exports and imports stored hashes and ordered history without a Redis client', async () => {
    const exported = await exportBackup({
      json: async () => ({ password: 'backup-password' }),
    } as never);
    expect(exported.status).toBe(200);
    const imported = await importBackup(request(await exported.text()));
    expect(imported.status).toBe(200);
    expect(db.getUserPassword).toHaveBeenCalledWith('alice');
    expect(db.restoreBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        userData: expect.objectContaining({
          alice: expect.objectContaining({
            password: 'stored-password-hash',
            searchHistory: ['latest', 'older'],
          }),
        }),
      })
    );
    expect(setCachedConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed backup data before any storage or cache replacement', async () => {
    const malformed = {
      data: {
        adminConfig: { SiteConfig: {} },
        userData: { alice: { searchHistory: [42] } },
      },
    };
    const encrypted = SimpleCrypto.encrypt(
      gzipSync(JSON.stringify(malformed)).toString('base64'),
      'backup-password'
    );
    expect((await importBackup(request(encrypted))).status).toBe(400);
    expect(db.restoreBackup).not.toHaveBeenCalled();
    expect(setCachedConfig).not.toHaveBeenCalled();
  });
});
