/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
jest.mock('./cloudflare-d1.db', () => ({
  CloudflareD1Storage: jest.fn().mockImplementation(() => ({
    getAllFavorites: jest.fn().mockResolvedValue({}),
  })),
}));
jest.mock('./cloudflare-kv.db', () => ({
  CloudflareKVStorage: jest.fn().mockImplementation(() => ({
    getAllFavorites: jest.fn(() => {
      throw new Error('KV must not be used after runtime selects D1');
    }),
  })),
}));

import { CloudflareD1Storage } from './cloudflare-d1.db';
import { CloudflareKVStorage } from './cloudflare-kv.db';

it('selects D1 from the private runtime setting even when the public build value is KV', async () => {
  const originalRuntime = process.env.STORAGE_TYPE;
  const originalPublic = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  try {
    delete process.env.STORAGE_TYPE;
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'cloudflare-kv';
    const { db } = require('./db');
    // Simulate the host injecting private settings after the module was loaded.
    process.env.STORAGE_TYPE = 'cloudflare-d1';
    await expect(db.getAllFavorites('alice')).resolves.toEqual({});
    expect(CloudflareD1Storage).toHaveBeenCalledTimes(1);
    expect(CloudflareKVStorage).toHaveBeenCalledTimes(1);
  } finally {
    if (originalRuntime === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = originalRuntime;
    if (originalPublic === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalPublic;
  }
});
