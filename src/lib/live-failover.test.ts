import { nextLiveAlternative } from './live-failover';

const channels = [
  { name: 'CCTV-1 (720p)', tvgId: '', url: 'https://a.test/1' },
  { name: 'CCTV-13', tvgId: '', url: 'https://b.test/13' },
  { name: 'CCTV-1综合', tvgId: '', url: 'https://b.test/1' },
  { name: 'CCTV-1', tvgId: '', url: 'https://c.test/1' },
  { name: 'CCTV-1 高清', tvgId: '', url: 'https://d.test/1' },
];

it('only tries new addresses of the same station and stops after three failures', () => {
  const attempted = new Set([channels[0].url]);
  expect(nextLiveAlternative(channels, channels[0], attempted)).toBe(
    channels[2]
  );
  attempted.add(channels[2].url);
  expect(nextLiveAlternative(channels, channels[2], attempted)).toBe(
    channels[3]
  );
  attempted.add(channels[3].url);
  expect(nextLiveAlternative(channels, channels[3], attempted)).toBeUndefined();
});

it('distinguishes CCTV5 from CCTV5+ and returns no unrelated fallback', () => {
  expect(
    nextLiveAlternative(
      [{ name: 'CCTV5+', tvgId: '', url: 'https://b.test' }],
      { name: 'CCTV5', tvgId: '', url: 'https://a.test' },
      new Set()
    )
  ).toBeUndefined();
  expect(nextLiveAlternative(channels, channels[1], new Set())).toBeUndefined();
});
