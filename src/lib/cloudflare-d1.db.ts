import { AdminConfig } from './admin.types';
import { hashPassword, isHashed, verifyPassword } from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

// Structural binding types keep tests independent of the Workers runtime.
export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface CloudflareD1Binding {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

type DataKind = 'play' | 'favorite' | 'skip' | 'search';

function getRuntimeBinding(): CloudflareD1Binding {
  // Resolve per request; never retain a binding or start I/O during import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
    getCloudflareContext(options: { async: false }): {
      env: { LUNATV_D1?: CloudflareD1Binding };
    };
  };
  const binding = getCloudflareContext({ async: false }).env.LUNATV_D1;
  if (!binding) {
    throw new Error(
      'Cloudflare D1 binding LUNATV_D1 is missing. Bind a database and apply migrations/0001_storage.sql before selecting cloudflare-d1.'
    );
  }
  return binding;
}

export class CloudflareD1Storage implements IStorage {
  constructor(private readonly injectedBinding?: CloudflareD1Binding) {}

  private get d1(): CloudflareD1Binding {
    return this.injectedBinding ?? getRuntimeBinding();
  }

  private async read<T>(username: string, kind: DataKind, key: string) {
    const row = await this.d1
      .prepare(
        'SELECT value FROM user_data WHERE username = ?1 AND kind = ?2 AND item_key = ?3'
      )
      .bind(username, kind, key)
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private async write<T>(
    username: string,
    kind: DataKind,
    key: string,
    value: T
  ) {
    await this.d1
      .prepare(
        `INSERT INTO user_data (username, kind, item_key, value)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (username, kind, item_key) DO UPDATE SET value = excluded.value
         WHERE user_data.value <> excluded.value`
      )
      .bind(username, kind, key, JSON.stringify(value))
      .run();
  }

  private async all<T>(
    username: string,
    kind: DataKind
  ): Promise<Record<string, T>> {
    const { results } = await this.d1
      .prepare(
        'SELECT item_key, value FROM user_data WHERE username = ?1 AND kind = ?2'
      )
      .bind(username, kind)
      .all<{ item_key: string; value: string }>();
    return Object.fromEntries(
      results.map((row) => [row.item_key, JSON.parse(row.value) as T])
    );
  }

  private async remove(username: string, kind: DataKind, key?: string) {
    const statement =
      key === undefined
        ? this.d1
            .prepare('DELETE FROM user_data WHERE username = ?1 AND kind = ?2')
            .bind(username, kind)
        : this.d1
            .prepare(
              'DELETE FROM user_data WHERE username = ?1 AND kind = ?2 AND item_key = ?3'
            )
            .bind(username, kind, key);
    await statement.run();
  }

  getPlayRecord(username: string, key: string): Promise<PlayRecord | null> {
    return this.read(username, 'play', key);
  }

  setPlayRecord(
    username: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    return this.write(username, 'play', key, record);
  }

  getAllPlayRecords(username: string): Promise<Record<string, PlayRecord>> {
    return this.all(username, 'play');
  }

  deletePlayRecord(username: string, key: string): Promise<void> {
    return this.remove(username, 'play', key);
  }

  deleteAllPlayRecords(username: string): Promise<void> {
    return this.remove(username, 'play');
  }

  getFavorite(username: string, key: string): Promise<Favorite | null> {
    return this.read(username, 'favorite', key);
  }

  setFavorite(
    username: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    return this.write(username, 'favorite', key, favorite);
  }

  getAllFavorites(username: string): Promise<Record<string, Favorite>> {
    return this.all(username, 'favorite');
  }

  deleteFavorite(username: string, key: string): Promise<void> {
    return this.remove(username, 'favorite', key);
  }

  deleteAllFavorites(username: string): Promise<void> {
    return this.remove(username, 'favorite');
  }

  async registerUser(username: string, password: string): Promise<void> {
    await this.d1
      .prepare('INSERT INTO users (username, password) VALUES (?1, ?2)')
      .bind(username, hashPassword(password))
      .run();
  }

  async verifyUser(username: string, password: string): Promise<boolean> {
    const row = await this.d1
      .prepare('SELECT password FROM users WHERE username = ?1')
      .bind(username)
      .first<{ password: string }>();
    if (!row || !verifyPassword(password, row.password)) return false;
    if (!isHashed(row.password)) {
      // Compare-and-set prevents a login from undoing a concurrent password change.
      await this.d1
        .prepare(
          'UPDATE users SET password = ?1 WHERE username = ?2 AND password = ?3'
        )
        .bind(hashPassword(password), username, row.password)
        .run();
    }
    return true;
  }

  async checkUserExist(username: string): Promise<boolean> {
    return (
      (await this.d1
        .prepare('SELECT 1 AS found FROM users WHERE username = ?1')
        .bind(username)
        .first()) !== null
    );
  }

  async changePassword(username: string, password: string): Promise<void> {
    await this.d1
      .prepare('UPDATE users SET password = ?1 WHERE username = ?2')
      .bind(hashPassword(password), username)
      .run();
  }

  async deleteUser(username: string): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare('DELETE FROM user_data WHERE username = ?1')
        .bind(username),
      this.d1.prepare('DELETE FROM users WHERE username = ?1').bind(username),
    ]);
  }

  async getAllUsers(): Promise<string[]> {
    const { results } = await this.d1
      .prepare('SELECT username FROM users ORDER BY username')
      .all<{ username: string }>();
    return results.map((row) => row.username);
  }

  async getSearchHistory(username: string): Promise<string[]> {
    return (await this.read<string[]>(username, 'search', '')) ?? [];
  }

  async addSearchHistory(username: string, keyword: string): Promise<void> {
    // Build the bounded, deduplicated array inside one atomic SQL statement.
    await this.d1
      .prepare(
        `INSERT INTO user_data (username, kind, item_key, value)
       VALUES (?1, 'search', '', (
         SELECT json_group_array(value) FROM (
           SELECT ?2 AS value
           UNION ALL
           SELECT value FROM json_each(COALESCE((
             SELECT value FROM user_data WHERE username = ?1 AND kind = 'search' AND item_key = ''
           ), '[]')) WHERE value <> ?2 LIMIT 20
         )
       ))
       ON CONFLICT (username, kind, item_key) DO UPDATE SET value = excluded.value
       WHERE user_data.value <> excluded.value`
      )
      .bind(username, keyword)
      .run();
  }

  async deleteSearchHistory(username: string, keyword?: string): Promise<void> {
    if (!keyword) return this.remove(username, 'search');
    await this.d1
      .prepare(
        `UPDATE user_data SET value = (
         SELECT json_group_array(value) FROM json_each(user_data.value) WHERE value <> ?2
       ) WHERE username = ?1 AND kind = 'search' AND item_key = ''
       AND EXISTS (SELECT 1 FROM json_each(user_data.value) WHERE value = ?2)`
      )
      .bind(username, keyword)
      .run();
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const row = await this.d1
      .prepare("SELECT value FROM settings WHERE key = 'admin:config'")
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('admin:config', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE settings.value <> excluded.value`
      )
      .bind(JSON.stringify(config))
      .run();
  }

  getSkipConfig(
    username: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    return this.read(username, 'skip', `${source}+${id}`);
  }

  setSkipConfig(
    username: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    return this.write(username, 'skip', `${source}+${id}`, config);
  }

  deleteSkipConfig(
    username: string,
    source: string,
    id: string
  ): Promise<void> {
    return this.remove(username, 'skip', `${source}+${id}`);
  }

  getAllSkipConfigs(username: string): Promise<Record<string, SkipConfig>> {
    return this.all(username, 'skip');
  }

  async clearAllData(): Promise<void> {
    // D1 batch runs all statements in a transaction and rolls back on failure.
    await this.d1.batch([
      this.d1.prepare('DELETE FROM user_data'),
      this.d1.prepare('DELETE FROM users'),
      this.d1.prepare('DELETE FROM settings'),
    ]);
  }
}
