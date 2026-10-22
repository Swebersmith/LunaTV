import { clearAdminConfigPrefetch, loadAdminConfig, prefetchAdminConfig } from './admin-config-client';

const mockFetch = jest.fn();
const config = { Role: 'owner', Config: { SiteConfig: { SiteName: 'CrayonTV' } } };
const respond = (data = config) => ({ ok: true, json: async () => data });
function login(username = 'admin', role = 'owner') {
  document.cookie = `auth=${encodeURIComponent(JSON.stringify({ username, role }))}; path=/`;
}

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = mockFetch;
  mockFetch.mockReset().mockResolvedValue(respond());
  login();
});
afterEach(() => {
  clearAdminConfigPrefetch();
  jest.useRealTimers();
});

it('starts early and reuses one in-flight request when entering the panel', async () => {
  let finish!: (value: ReturnType<typeof respond>) => void;
  mockFetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  prefetchAdminConfig();
  prefetchAdminConfig();
  const loading = loadAdminConfig(true);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  finish(respond());
  await expect(loading).resolves.toEqual(config);
  expect(mockFetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
});

it('consumes prepared configuration once and refreshes from the server after changes', async () => {
  prefetchAdminConfig();
  await loadAdminConfig(true);
  await loadAdminConfig();
  await loadAdminConfig(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

it('does not serve a prepared result to a different session', async () => {
  prefetchAdminConfig();
  login('another-admin', 'admin');
  await loadAdminConfig(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('expires speculative configuration if the visitor does not enter', async () => {
  prefetchAdminConfig();
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(15001);
  await loadAdminConfig(true);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('does not request admin data for regular users', () => {
  login('viewer', 'user');
  prefetchAdminConfig();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('clears failed preloads so entering the panel can retry', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  await prefetchAdminConfig();
  await expect(loadAdminConfig(true)).resolves.toEqual(config);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('discards speculative configuration before a fresh refresh', async () => {
  prefetchAdminConfig();
  await loadAdminConfig();
  await loadAdminConfig(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

it('ends a stalled request and allows a later retry', async () => {
  mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const request = loadAdminConfig();
  const failure = expect(request).rejects.toThrow('加载超时');
  jest.advanceTimersByTime(15000);
  await failure;
  await expect(loadAdminConfig(true)).resolves.toEqual(config);
});
