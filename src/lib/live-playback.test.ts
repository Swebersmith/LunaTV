import { TextDecoder, TextEncoder } from 'util';

import {
  liveBufferAhead,
  liveResourceLimited,
  liveStartupBuffer,
} from './live-playback';

Object.assign(global, { TextDecoder, TextEncoder });

it('recognizes platform resource errors without treating ordinary upstream failures as a platform outage', () => {
  expect(liveResourceLimited(500, '<h1>Error 1102</h1>')).toBe(true);
  expect(liveResourceLimited(530, 'error code: 1102')).toBe(true);
  expect(
    liveResourceLimited(
      500,
      new TextEncoder().encode('Worker exceeded resource limits').buffer
    )
  ).toBe(true);
  expect(liveResourceLimited(200, 'Error 1102')).toBe(false);
  expect(liveResourceLimited(503, 'upstream temporarily unavailable')).toBe(
    false
  );
});

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
