import { AdminConfig } from './admin.types';
import { hashPassword, isHashed, verifyPassword } from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

const SEARCH_HISTORY_LIMIT = 20;

export interface CloudflareKVBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

type CloudflareContext = {
  env?: {
    LUNATV_KV?: CloudflareKVBinding;
  };
};

type GetCloudflareContext = (options: { async: false }) => CloudflareContext;

function getRuntimeBinding(): CloudflareKVBinding {
  // Keep OpenNext out of the module's top-level dependency graph. DbManager is
  // created during import, while the Cloudflare context only exists per request.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
    getCloudflareContext: GetCloudflareContext;
  };
  const context = getCloudflareContext({ async: false });
  const binding = context.env?.LUNATV_KV;
  if (!binding) {
    throw new Error(
      'Cloudflare KV binding LUNATV_KV is not available. Add the binding before using cloudflare-kv storage.'
    );
  }
  return binding;
}

export class CloudflareKVStorage implements IStorage {
  private readonly injectedBinding?: CloudflareKVBinding;

  constructor(binding?: CloudflareKVBinding) {
    this.injectedBinding = binding;
  }

  private get kv(): CloudflareKVBinding {
    return this.injectedBinding ?? getRuntimeBinding();
  }

  private async read<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key);
    if (value === null) return null;

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new Error(`Invalid JSON stored at Cloudflare KV key "${key}"`, {
        cause: error,
      });
    }
  }

  private async write<T>(key: string, value: T): Promise<void> {
    await this.kv.put(key, JSON.stringify(value));
  }

  private playRecordsKey(userName: string): string {
    return `u:${userName}:pr`;
  }

  private favoritesKey(userName: string): string {
    return `u:${userName}:fav`;
  }

  private searchHistoryKey(userName: string): string {
    return `u:${userName}:sh`;
  }

  private skipConfigsKey(userName: string): string {
    return `u:${userName}:skip`;
  }

  private passwordKey(userName: string): string {
    return `u:${userName}:pwd`;
  }

  private usersKey(): string {
    return 'sys:users';
  }

  private adminConfigKey(): string {
    return 'admin:config';
  }

  private skipField(source: string, id: string): string {
    return `${source}+${id}`;
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const records = await this.read<Record<string, PlayRecord>>(
      this.playRecordsKey(userName)
    );
    return records?.[key] ?? null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    const records =
      (await this.read<Record<string, PlayRecord>>(
        this.playRecordsKey(userName)
      )) ?? {};
    records[key] = record;
    await this.write(this.playRecordsKey(userName), records);
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<{ [key: string]: PlayRecord }> {
    return (
      (await this.read<Record<string, PlayRecord>>(
        this.playRecordsKey(userName)
      )) ?? {}
    );
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const records = await this.read<Record<string, PlayRecord>>(
      this.playRecordsKey(userName)
    );
    if (!records) return;
    delete records[key];
    if (Object.keys(records).length === 0) {
      await this.deleteAllPlayRecords(userName);
      return;
    }
    await this.write(this.playRecordsKey(userName), records);
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.kv.delete(this.playRecordsKey(userName));
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const favorites = await this.read<Record<string, Favorite>>(
      this.favoritesKey(userName)
    );
    return favorites?.[key] ?? null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    const favorites =
      (await this.read<Record<string, Favorite>>(
        this.favoritesKey(userName)
      )) ?? {};
    favorites[key] = favorite;
    await this.write(this.favoritesKey(userName), favorites);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return (
      (await this.read<Record<string, Favorite>>(
        this.favoritesKey(userName)
      )) ?? {}
    );
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const favorites = await this.read<Record<string, Favorite>>(
      this.favoritesKey(userName)
    );
    if (!favorites) return;
    delete favorites[key];
    if (Object.keys(favorites).length === 0) {
      await this.deleteAllFavorites(userName);
      return;
    }
    await this.write(this.favoritesKey(userName), favorites);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.kv.delete(this.favoritesKey(userName));
  }

  async registerUser(userName: string, password: string): Promise<void> {
    await this.write(this.passwordKey(userName), hashPassword(password));

    const users = (await this.read<string[]>(this.usersKey())) ?? [];
    if (!users.includes(userName)) {
      users.push(userName);
      await this.write(this.usersKey(), users);
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.read<string>(this.passwordKey(userName));
    if (stored === null) return false;

    const valid = verifyPassword(password, stored);
    if (valid && !isHashed(stored)) {
      await this.write(this.passwordKey(userName), hashPassword(password));
    }
    return valid;
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return (await this.kv.get(this.passwordKey(userName))) !== null;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.write(this.passwordKey(userName), hashPassword(newPassword));
  }

  async deleteUser(userName: string): Promise<void> {
    await Promise.all([
      this.kv.delete(this.passwordKey(userName)),
      this.kv.delete(this.playRecordsKey(userName)),
      this.kv.delete(this.favoritesKey(userName)),
      this.kv.delete(this.searchHistoryKey(userName)),
      this.kv.delete(this.skipConfigsKey(userName)),
    ]);

    const users = await this.read<string[]>(this.usersKey());
    if (!users) return;
    const remaining = users.filter((user) => user !== userName);
    if (remaining.length === 0) {
      await this.kv.delete(this.usersKey());
    } else if (remaining.length !== users.length) {
      await this.write(this.usersKey(), remaining);
    }
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return (await this.read<string[]>(this.searchHistoryKey(userName))) ?? [];
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const history = (await this.getSearchHistory(userName)).filter(
      (item) => item !== keyword
    );
    history.unshift(keyword);
    await this.write(
      this.searchHistoryKey(userName),
      history.slice(0, SEARCH_HISTORY_LIMIT)
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (!keyword) {
      await this.kv.delete(this.searchHistoryKey(userName));
      return;
    }

    const history = await this.getSearchHistory(userName);
    const remaining = history.filter((item) => item !== keyword);
    if (remaining.length === 0) {
      await this.kv.delete(this.searchHistoryKey(userName));
    } else {
      await this.write(this.searchHistoryKey(userName), remaining);
    }
  }

  async getAllUsers(): Promise<string[]> {
    return (await this.read<string[]>(this.usersKey())) ?? [];
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.read<AdminConfig>(this.adminConfigKey());
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.write(this.adminConfigKey(), config);
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const configs = await this.read<Record<string, SkipConfig>>(
      this.skipConfigsKey(userName)
    );
    return configs?.[this.skipField(source, id)] ?? null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    const key = this.skipConfigsKey(userName);
    const configs = (await this.read<Record<string, SkipConfig>>(key)) ?? {};
    configs[this.skipField(source, id)] = config;
    await this.write(key, configs);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = this.skipConfigsKey(userName);
    const configs = await this.read<Record<string, SkipConfig>>(key);
    if (!configs) return;
    delete configs[this.skipField(source, id)];
    if (Object.keys(configs).length === 0) {
      await this.kv.delete(key);
    } else {
      await this.write(key, configs);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    return (
      (await this.read<Record<string, SkipConfig>>(
        this.skipConfigsKey(userName)
      )) ?? {}
    );
  }

  async clearAllData(): Promise<void> {
    if (!this.kv.list) {
      throw new Error('Cloudflare KV binding does not support listing keys.');
    }

    let cursor: string | undefined;
    do {
      const result = await this.kv.list({ cursor });
      await Promise.all(result.keys.map(({ name }) => this.kv.delete(name)));
      cursor = result.list_complete ? undefined : result.cursor;
      if (!result.list_complete && !cursor) {
        throw new Error(
          'Cloudflare KV returned no cursor for an incomplete list.'
        );
      }
    } while (cursor);
  }
}
