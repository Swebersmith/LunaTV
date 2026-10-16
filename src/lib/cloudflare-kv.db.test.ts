import { CloudflareKVBinding, CloudflareKVStorage } from './cloudflare-kv.db';

class MemoryKV implements CloudflareKVBinding {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('CloudflareKVStorage', () => {
  it('does not repeat identical writes or write during reads', async () => {
    const binding = new MemoryKV();
    const put = jest.spyOn(binding, 'put');
    const storage = new CloudflareKVStorage(binding);
    const config = { ConfigFile: '', SourceConfig: [] } as never;
    await storage.setAdminConfig(config);
    await storage.setAdminConfig(config);
    await storage.getAdminConfig();
    await storage.getAllFavorites('alice');
    expect(put).toHaveBeenCalledTimes(1);
    await storage.addSearchHistory('alice', 'Example');
    await storage.addSearchHistory('alice', 'Example');
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('round-trips admin configuration through KV', async () => {
    const storage = new CloudflareKVStorage(new MemoryKV());
    const config = {
      ConfigFile: '',
      ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
      SiteConfig: {} as never,
      UserConfig: { Users: [] },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
    };

    await storage.setAdminConfig(config);

    await expect(storage.getAdminConfig()).resolves.toEqual(config);
  });

  it('isolates user records and removes all records when a user is deleted', async () => {
    const storage = new CloudflareKVStorage(new MemoryKV());
    const record = {
      title: 'Example',
      source_name: 'source',
      cover: '',
      year: '2026',
      index: 1,
      total_episodes: 1,
      play_time: 10,
      total_time: 100,
      save_time: 1,
      search_title: 'Example',
    };

    await storage.registerUser('alice', 'password');
    await storage.setPlayRecord('alice', 'source+1', record);
    await storage.addSearchHistory('alice', 'Example');
    await storage.setSkipConfig('alice', 'source', '1', {
      enable: true,
      intro_time: 5,
      outro_time: 6,
    });

    await expect(storage.getPlayRecord('alice', 'source+1')).resolves.toEqual(
      record
    );
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([
      'Example',
    ]);
    await expect(
      storage.getSkipConfig('alice', 'source', '1')
    ).resolves.toEqual({
      enable: true,
      intro_time: 5,
      outro_time: 6,
    });

    await storage.deleteUser('alice');

    await expect(storage.checkUserExist('alice')).resolves.toBe(false);
    await expect(
      storage.getPlayRecord('alice', 'source+1')
    ).resolves.toBeNull();
    await expect(storage.getSearchHistory('alice')).resolves.toEqual([]);
    await expect(
      storage.getSkipConfig('alice', 'source', '1')
    ).resolves.toBeNull();
  });

  it('returns empty collections for missing values', async () => {
    const storage = new CloudflareKVStorage(new MemoryKV());

    await expect(storage.getAllPlayRecords('missing')).resolves.toEqual({});
    await expect(storage.getAllFavorites('missing')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('missing')).resolves.toEqual({});
    await expect(storage.getAdminConfig()).resolves.toBeNull();
  });
});
