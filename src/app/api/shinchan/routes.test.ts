/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      options?: { status?: number; headers?: unknown }
    ) => ({ status: options?.status || 200, body, headers: options?.headers }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest
    .fn()
    .mockResolvedValue([
      { key: 'allowed', name: 'Allowed', api: 'https://example.test/api' },
    ]),
  getConfig: jest
    .fn()
    .mockResolvedValue({ SiteConfig: { DisableYellowFilter: false } }),
}));
jest.mock('@/lib/downstream', () => ({
  searchPageFromApi: jest.fn().mockResolvedValue({ results: [], pageCount: 8 }),
}));
jest.mock('@/lib/shinchan-metadata', () => ({
  getShinchanCatalog: jest.fn().mockResolvedValue({ movies: [] }),
}));
jest.mock('@/lib/db', () => ({
  db: { saveAdminConfig: jest.fn(), setCache: jest.fn() },
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';
import { db } from '@/lib/db';
import { searchPageFromApi } from '@/lib/downstream';
import { getShinchanCatalog } from '@/lib/shinchan-metadata';

import { GET as catalog } from './catalog/route';
import { GET as search } from './search/route';

const request = (query = '') =>
  ({ url: `https://example.test/api/shinchan/search${query}` } as NextRequest);
beforeEach(() => {
  jest.clearAllMocks();
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({ username: 'member' });
});

it('rejects anonymous calls before reading permitted sources or public catalog upstreams', async () => {
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);
  expect((await search(request())).status).toBe(401);
  expect((await catalog(request())).status).toBe(401);
  expect(getAvailableApiSites).not.toHaveBeenCalled();
  expect(getShinchanCatalog).not.toHaveBeenCalled();
});

it('prevents querying another user’s source or arbitrary search terms', async () => {
  expect((await search(request('?source=forbidden'))).status).toBe(403);
  expect((await search(request('?source=allowed&q=other'))).status).toBe(400);
  expect((await search(request('?source=allowed&page=101'))).status).toBe(400);
  expect(searchPageFromApi).not.toHaveBeenCalled();
});

it('allows later pages without exposing provider URLs and never persists config or user data', async () => {
  await search(request());
  expect(getAvailableApiSites).toHaveBeenCalledWith('member');
  expect((await search(request('?source=allowed&page=6'))).status).toBe(200);
  expect(searchPageFromApi).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'allowed' }),
    '蜡笔小新',
    6
  );
  await catalog(request());
  expect(db.saveAdminConfig).not.toHaveBeenCalled();
});
