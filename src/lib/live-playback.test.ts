import { liveBufferAhead, liveStartupBuffer } from './live-playback';

it('limits initial buffering to what short or unusually long live windows can supply', () => {
  expect(
    liveStartupBuffer({ live: true, targetduration: 2, totalduration: 6 })
  ).toBe(4);
  expect(
    liveStartupBuffer({ live: true, targetduration: 1, totalduration: 1 })
  ).toBe(0);
  expect(
    liveStartupBuffer({ live: true, targetduration: 12, totalduration: 36 })
  ).toBe(10);
  expect(
    liveStartupBuffer({ live: false, targetduration: 12, totalduration: 36 })
  ).toBe(0);
  expect(liveStartupBuffer()).toBe(0);
});

it('counts only playable media ahead of the current position, excluding future gaps', () => {
  const buffered = {
    length: 2,
    start: (index: number) => [0, 20][index],
    end: (index: number) => [10, 30][index],
  };
  expect(liveBufferAhead({ currentTime: 5, buffered })).toBe(5);
  expect(liveBufferAhead({ currentTime: 15, buffered })).toBe(0);
  expect(liveBufferAhead({ currentTime: 25, buffered })).toBe(5);
});
