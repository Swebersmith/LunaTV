/** @jest-environment node */
jest.mock('next/server', () => ({
  NextRequest: class {
    constructor(
      _url: string,
      private readonly options?: { headers?: Record<string, string> }
    ) {}
    headers = { get: (name: string) => this.options?.headers?.[name] ?? null };
  },
  NextResponse: {
    json: (_body: unknown, options?: { status: number }) => ({
      status: options?.status ?? 200,
    }),
  },
}));
jest.mock('@/lib/db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
    getAllUsers: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ LiveConfig: [] }),
  refineConfig: jest.fn(),
}));
jest.mock('@/lib/live', () => ({ refreshLiveChannels: jest.fn() }));
jest.mock('@/lib/fetchVideoDetail', () => ({ fetchVideoDetail: jest.fn() }));

import { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { GET } from './route';

describe('cron write protection', () => {
  const request = (authorization = '') =>
    new NextRequest('http://localhost/api/cron', {
      headers: { authorization },
    });
  const originalSecret = process.env.CRON_SECRET;
  const originalUsername = process.env.USERNAME;
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.USERNAME;
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
  });

  it('disables cron without a secret and rejects anonymous and incorrect tokens before storage access', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request())).status).toBe(503);
    process.env.CRON_SECRET = 'test-only-secret';
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    expect(getConfig).not.toHaveBeenCalled();
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
  });

  it('awaits an authenticated refresh and does not save config when there are no changes', async () => {
    process.env.CRON_SECRET = 'test-only-secret';
    const response = await GET(request('Bearer test-only-secret'));
    expect(response.status).toBe(200);
    expect(db.getAllUsers).toHaveBeenCalledTimes(1);
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
  });
});
