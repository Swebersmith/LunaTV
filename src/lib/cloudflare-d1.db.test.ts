/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { CloudflareD1Binding, CloudflareD1Storage } from './cloudflare-d1.db';
import { hashPassword } from './password';
import { StorageBackup } from './types';

// Use the exact Miniflare/workerd version already bundled with Wrangler.
const { Miniflare } = require(require.resolve('miniflare', {
  paths: [require.resolve('wrangler/package.json')],
}));

// Starting a real workerd process can exceed Jest's 5s default on Windows.
jest.setTimeout(30000);

describe('Cloudflare D1 storage (real SQLite in workerd)', () => {
  let runtime: {
    getD1Database(name: string): Promise<CloudflareD1Binding>;
    dispose(): Promise<void>;
  };
  let binding: CloudflareD1Binding;
  let storage: CloudflareD1Storage;
  const record = {
    title: 'Example',
    source_name: 'source',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 2,
    play_time: 10,
    total_time: 100,
    save_time: 1,
    search_title: 'Example',
  };

  beforeEach(async () => {
    runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: '2025-04-01',
      d1Databases: ['LUNATV_D1'],
    });
    binding = await runtime.getD1Database('LUNATV_D1');
    const schema = readFileSync(resolve('migrations/0001_storage.sql'), 'utf8');
    await binding.batch(
      schema
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => binding.prepare(sql))
    );
    storage = new CloudflareD1Storage(binding);
  });

  afterEach(async () => {
    await runtime?.dispose();
  });

  it('initializes an empty or newly rebound database, without repeated schema writes', async () => {
    await binding.batch(
      ['users', 'user_data', 'settings'].map((name) =>
        binding.prepare(`DROP TABLE ${name}`)
      )
    );
    const batch = jest.fn(
      (statements: Parameters<CloudflareD1Binding['batch']>[0]) =>
        binding.batch(statements)
    );
    storage = new CloudflareD1Storage({
      prepare: (sql) => binding.prepare(sql),
      batch,
    });
    await Promise.all([
      storage.getAdminConfig(),
      storage.getAllUsers(),
      storage.getAllFavorites('alice'),
    ]);
    expect(batch).toHaveBeenCalled();
    batch.mockClear();
    await storage.getAdminConfig();
    await storage.registerUser('alice', 'secret');
    await storage.getAllFavorites('alice');
    expect(batch).not.toHaveBeenCalled();
    await binding.prepare('DROP TABLE settings').run();
    await expect(storage.getAdminConfig()).resolves.toBeNull();
    expect(batch).toHaveBeenCalledTimes(1);
    await expect(storage.verifyUser('alice', 'secret')).resolves.toBe(true);
  });

  it('restores all collections and original password hashes atomically', async () => {
    await storage.registerUser('alice', 'original');
    const password = await storage.getUserPassword('alice');
    const favorite = { ...record, origin: 'live' as const };
    const skip = { enable: true, intro_time: 5, outro_time: 8 };
    const backup: StorageBackup = {
      adminConfig: { SiteConfig: { SiteName: 'restored' } } as never,
      userData: {
        alice: {
          password,
          playRecords: { 's+1': record },
          favorites: { 'live+2': favorite },
          searchHistory: ['latest', 'older'],
          skipConfigs: { 's+id+part': skip },
        },
        legacy: { password: 'plaintext' },
      },
    };
    await storage.registerUser('obsolete', 'removed');
    await storage.restoreBackup(backup);
    await expect(storage.getUserPassword('alice')).resolves.toBe(password);
    await expect(storage.verifyUser('alice', 'original')).resolves.toBe(true);
    await expect(storage.verifyUser('legacy', 'plaintext')).resolves.toBe(true);
    await expect(storage.getAllUsers()).resolves.toEqual(['alice', 'legacy']);
    await expect(storage.getAllPlayRecords('alice')).resolves.toEqual({
      's+1': record,
    });
    await expect(storage.getAllFavorites('alice')).resolves.toEqual({
      'live+2': favorite,
    });
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([
      'latest',
      'older',
    ]);
    await expect(
      storage.getSkipConfig('alice', 's', 'id+part')
    ).resolves.toEqual(skip);
    await expect(storage.getAdminConfig()).resolves.toEqual(backup.adminConfig);

    await binding
      .prepare(
        "CREATE TRIGGER reject_restore BEFORE INSERT ON users WHEN NEW.username = 'rejected' BEGIN SELECT RAISE(ABORT, 'restore failed'); END"
      )
      .run();
    await expect(
      storage.restoreBackup({
        ...backup,
        userData: { rejected: { password: 'x' } },
      })
    ).rejects.toThrow('restore failed');
    await expect(storage.verifyUser('alice', 'original')).resolves.toBe(true);
    await expect(storage.getAllPlayRecords('alice')).resolves.toEqual({
      's+1': record,
    });
    await expect(storage.getAdminConfig()).resolves.toEqual(backup.adminConfig);
  });

  it('reads empty collections and missing values without creating rows', async () => {
    await expect(storage.getAdminConfig()).resolves.toBeNull();
    await expect(storage.getPlayRecord('alice', 's+1')).resolves.toBeNull();
    await expect(storage.getAllPlayRecords('alice')).resolves.toEqual({});
    await expect(storage.getAllFavorites('alice')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('alice')).resolves.toEqual({});
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([]);
    await expect(
      binding.prepare('SELECT COUNT(*) AS count FROM user_data').first()
    ).resolves.toEqual({ count: 0 });
  });

  it('preserves separate video updates and isolates users', async () => {
    await Promise.all([
      storage.setPlayRecord('alice', 's+1', record),
      storage.setPlayRecord('alice', 's+2', { ...record, index: 2 }),
      storage.setPlayRecord('bob', 's+1', { ...record, play_time: 70 }),
    ]);
    expect(Object.keys(await storage.getAllPlayRecords('alice'))).toEqual([
      's+1',
      's+2',
    ]);
    await storage.deletePlayRecord('alice', 's+1');
    await expect(storage.getPlayRecord('alice', 's+2')).resolves.toEqual({
      ...record,
      index: 2,
    });
    await expect(storage.getPlayRecord('bob', 's+1')).resolves.toEqual({
      ...record,
      play_time: 70,
    });
  });

  it('does not write unchanged records or settings', async () => {
    let changes = 0;
    const measured: CloudflareD1Binding = {
      ...binding,
      batch: (statements) => binding.batch(statements),
      prepare(sql) {
        let statement = binding.prepare(sql);
        return {
          bind(...values) {
            statement = statement.bind(...values);
            return this;
          },
          first: () => statement.first(),
          all: () => statement.all(),
          async run() {
            const result = (await statement.run()) as {
              meta: { changes: number };
            };
            changes += result.meta.changes;
            return result;
          },
        };
      },
    };
    const measuredStorage = new CloudflareD1Storage(measured);
    await measuredStorage.setPlayRecord('alice', 's+1', record);
    expect(changes).toBe(1);
    await measuredStorage.setPlayRecord('alice', 's+1', record);
    await measuredStorage.getAllPlayRecords('alice');
    expect(changes).toBe(1);
    const config = { ConfigFile: '', SourceConfig: [] } as never;
    await measuredStorage.setAdminConfig(config);
    await measuredStorage.setAdminConfig(config);
    await expect(measuredStorage.getAdminConfig()).resolves.toEqual(config);
    expect(changes).toBe(2);
  });

  it('keeps imported hashes usable, upgrades plaintext, and changes passwords', async () => {
    await binding
      .prepare('INSERT INTO users VALUES (?1, ?2)')
      .bind('imported', hashPassword('old'))
      .run();
    await binding
      .prepare('INSERT INTO users VALUES (?1, ?2)')
      .bind('legacy', 'plain')
      .run();
    await expect(storage.verifyUser('imported', 'old')).resolves.toBe(true);
    await expect(storage.verifyUser('legacy', 'plain')).resolves.toBe(true);
    await expect(storage.verifyUser('legacy', 'wrong')).resolves.toBe(false);
    await storage.registerUser('alice', 'first');
    await storage.changePassword('alice', 'second');
    await expect(storage.verifyUser('alice', 'first')).resolves.toBe(false);
    await expect(storage.verifyUser('alice', 'second')).resolves.toBe(true);
    await expect(storage.getAllUsers()).resolves.toEqual([
      'alice',
      'imported',
      'legacy',
    ]);
  });

  it('atomically deduplicates and caps search history', async () => {
    for (let index = 0; index < 25; index++)
      await storage.addSearchHistory('alice', String(index));
    await storage.addSearchHistory('alice', '12');
    const history = await storage.getSearchHistory('alice');
    expect(history).toHaveLength(20);
    expect(history[0]).toBe('12');
    expect(new Set(history).size).toBe(20);
    await Promise.all([
      storage.addSearchHistory('alice', 'A'),
      storage.addSearchHistory('alice', 'B'),
    ]);
    expect(await storage.getSearchHistory('alice')).toEqual(
      expect.arrayContaining(['A', 'B'])
    );
    await storage.deleteSearchHistory('alice', 'A');
    expect(await storage.getSearchHistory('alice')).not.toContain('A');
    await storage.deleteSearchHistory('alice');
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([]);
  });

  it('cleans only the selected user and clears all data transactionally', async () => {
    const favorite = { ...record, origin: 'live' as const };
    const skip = { enable: true, intro_time: 5, outro_time: 8 };
    await storage.registerUser('alice', 'password');
    await storage.setFavorite('alice', 's+1', favorite);
    await storage.setFavorite('bob', 's+1', favorite);
    await storage.setSkipConfig('alice', 's', '1', skip);
    await storage.addSearchHistory('alice', 'movie');
    await expect(storage.getSkipConfig('alice', 's', '1')).resolves.toEqual(
      skip
    );
    await storage.deleteUser('alice');
    await expect(storage.checkUserExist('alice')).resolves.toBe(false);
    await expect(storage.getAllFavorites('alice')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('alice')).resolves.toEqual({});
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([]);
    await expect(storage.getFavorite('bob', 's+1')).resolves.toEqual(favorite);
    await storage.clearAllData();
    await expect(storage.getAllFavorites('bob')).resolves.toEqual({});
    await expect(storage.getAllUsers()).resolves.toEqual([]);
  });
});
