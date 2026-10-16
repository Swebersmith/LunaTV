/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, options?: ResponseInit) =>
      new Response(JSON.stringify(body), options),
  },
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: () => ({ username: 'member' }),
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest
    .fn()
    .mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 1, DisableYellowFilter: true },
    }),
  getAvailableApiSites: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/downstream', () => ({
  searchFromApi: jest.fn().mockResolvedValue([]),
  getDetailFromApi: jest.fn().mockResolvedValue({ id: 'video' }),
}));
jest.mock('@/lib/yellow', () => ({ yellowWords: [] }));

import { NextRequest } from 'next/server';
import { runInThisContext } from 'vm';

import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';

import { GET as one } from './one/route';
import { GET as resources } from './resources/route';
import { GET as normal } from './route';
import { GET as streaming } from './ws/route';
import { GET as detail } from '../detail/route';

// Jest 27 omits the Web APIs provided by the Node host used by Next.js.
Object.assign(global, runInThisContext('({ Response, ReadableStream, TextEncoder, TextDecoder })'));

const request = {
  url: 'https://example.test/api/search?q=小新',
} as NextRequest;
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('finishes a stream when all sources have been disabled', async () => {
  const result = await streaming(request);
  const body = await result.text();
  expect(body).toContain('"type":"start"');
  expect(body).toContain('"type":"complete"');
  expect(result.headers.get('Cache-Control')).toContain('no-store');
});

it('does not publicly cache personalized or outdated source selections', async () => {
  jest.useFakeTimers();
  jest
    .mocked(getAvailableApiSites)
    .mockResolvedValueOnce([
      { key: 'one', name: '源', api: 'https://one.test/api' },
    ]);
  jest.mocked(searchFromApi).mockResolvedValueOnce([{ id: 'video' }] as never);
  const result = await normal(request);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(result.headers.get('Vary')).toBe('Cookie');
  expect(result.headers.get('CDN-Cache-Control')).toBeNull();
});

it('keeps single-source searches and details fresh after source edits or disabling', async () => {
  const source = { key: 'one', name: '源', api: 'https://one.test/api' };
  jest.mocked(getAvailableApiSites).mockResolvedValueOnce([source]).mockResolvedValueOnce([source]);
  jest.mocked(searchFromApi).mockResolvedValueOnce([{ id: 'video', title: '小新' }] as never);
  for (const [handler, url] of [[one, 'https://example.test/api/search/one?q=小新&resourceId=one'], [detail, 'https://example.test/api/detail?source=one&id=video']] as const) {
    const result = await handler({ url } as NextRequest);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  }
});

it('omits management-only notes from the compatible player resource listing', async () => {
  jest.mocked(getAvailableApiSites).mockResolvedValueOnce([{ key: 'one', name: '源', api: 'https://one.test/api', note: '管理备注' }]);
  const result = await resources(request);
  expect(await result.json()).toEqual([{ key: 'one', name: '源', api: 'https://one.test/api' }]);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
});
