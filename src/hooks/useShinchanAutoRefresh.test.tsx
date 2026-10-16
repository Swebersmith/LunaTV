import { act, render, screen } from '@testing-library/react';

import {
  SHINCHAN_AUTO_REFRESH_MS,
  useShinchanAutoRefresh,
} from './useShinchanAutoRefresh';

it('refreshes while visible, pauses in the background and checks again on return or reconnect', () => {
  jest.useFakeTimers();
  let visibility = 'visible';
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  const Component = () => {
    const { revision } = useShinchanAutoRefresh();
    return <output>{revision}</output>;
  };
  const { unmount } = render(<Component />);
  act(() => jest.advanceTimersByTime(SHINCHAN_AUTO_REFRESH_MS));
  expect(screen.getByRole('status')).toHaveTextContent('1');
  visibility = 'hidden';
  act(() => jest.advanceTimersByTime(SHINCHAN_AUTO_REFRESH_MS * 3));
  expect(screen.getByRole('status')).toHaveTextContent('1');
  visibility = 'visible';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByRole('status')).toHaveTextContent('2');
  act(() => window.dispatchEvent(new Event('online')));
  expect(screen.getByRole('status')).toHaveTextContent('3');
  unmount();
  expect(jest.getTimerCount()).toBe(0);
  if (original) Object.defineProperty(document, 'visibilityState', original);
  else delete (document as unknown as Record<string, unknown>).visibilityState;
  jest.useRealTimers();
});
