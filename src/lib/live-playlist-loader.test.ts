import { LivePlaylistGuard } from './live-playlist-loader';

function playlist(sequence: number, count = 3) {
  return `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n${Array.from(
    { length: count },
    (_, index) => `#EXTINF:10,\n${sequence + index}.ts\n`
  ).join('')}`;
}

it('rejects an interleaved stale replica without poisoning the accepted live sequence', () => {
  const guard = new LivePlaylistGuard();
  expect(guard.check('channel', playlist(48536), 0)).toBe('accept');
  expect(guard.check('channel', playlist(3781), 10000)).toBe('retry');
  expect(guard.check('channel', playlist(48537), 11000)).toBe('accept');
  expect(guard.check('channel', playlist(3782), 20000)).toBe('retry');
  expect(guard.check('channel', playlist(48538), 21000)).toBe('accept');
});

it('requests a fresh timeline after repeated resets instead of discarding a restarted source forever', () => {
  const guard = new LivePlaylistGuard();
  guard.check('channel', playlist(100), 0);
  expect(guard.check('channel', playlist(0), 10000)).toBe('retry');
  expect(guard.check('channel', playlist(1), 11000)).toBe('retry');
  expect(guard.check('channel', playlist(2), 12000)).toBe('restart');
  expect(new LivePlaylistGuard().check('channel', playlist(3), 13000)).toBe(
    'accept'
  );
});

it('rejects unrelated future windows but permits elapsed-time progress and keeps renditions separate', () => {
  const guard = new LivePlaylistGuard();
  guard.check('video', playlist(10), 0);
  expect(guard.check('video', playlist(50000), 10000)).toBe('retry');
  expect(guard.check('video', playlist(70), 600000)).toBe('accept');
  expect(guard.check('audio', playlist(50000), 600000)).toBe('accept');
  expect(guard.check('video', playlist(69), 601000)).toBe('accept');
});

it('leaves master playlists, VOD and non-playlist data to hls.js', () => {
  const guard = new LivePlaylistGuard();
  guard.check('channel', playlist(100), 0);
  expect(
    guard.check(
      'channel',
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8'
    )
  ).toBe('accept');
  expect(guard.check('channel', playlist(0) + '#EXT-X-ENDLIST\n')).toBe(
    'accept'
  );
  expect(guard.check('channel', new ArrayBuffer(0))).toBe('accept');
  expect(guard.check('channel', '#EXTM3U\n#EXTINF:10,\na.ts')).toBe('accept');
});

it('allows normal progress with short variable-duration segments after a delayed poll', () => {
  const guard = new LivePlaylistGuard();
  const short = (sequence: number) =>
    playlist(sequence).replace(/#EXTINF:10,/g, '#EXTINF:0.5,');
  guard.check('channel', short(10), 0);
  expect(guard.check('channel', short(170), 80000)).toBe('accept');
});
