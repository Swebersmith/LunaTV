import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnchorHTMLAttributes } from 'react';

import NavigationLink, { NavigationProgress } from './NavigationLink';

const mockPush = jest.fn();
let mockPath = '/douban';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    onClick,
    children,
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean | null }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !event.ctrlKey) mockPush(href);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  mockPath = '/douban';
  window.history.replaceState(null, '', '/douban?type=movie');
  jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('switches category queries immediately without a server navigation', () => {
  const history = jest.spyOn(window.history, 'pushState');
  render(
    <>
      <NavigationLink href='/douban?type=show'>综艺</NavigationLink>
      <NavigationProgress />
    </>
  );
  fireEvent.click(screen.getByRole('link', { name: '综艺' }));
  expect(history).toHaveBeenCalledWith(null, '', '/douban?type=show');
  expect(mockPush).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?type=show');
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps modified clicks native', () => {
  const history = jest.spyOn(window.history, 'pushState');
  render(<NavigationLink href='/douban?type=anime'>动漫</NavigationLink>);
  fireEvent.click(screen.getByRole('link'), { ctrlKey: true });
  expect(history).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('shows progress for a route change and cancels the fallback when navigation commits', () => {
  mockPath = '/';
  window.history.replaceState(null, '', '/');
  const view = render(
    <>
      <NavigationLink href='/douban?type=movie'>电影</NavigationLink>
      <NavigationProgress />
    </>
  );
  fireEvent.click(screen.getByRole('link'));
  expect(mockPush).toHaveBeenCalledWith('/douban?type=movie');
  expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
  expect(jest.getTimerCount()).toBe(1);
  mockPath = '/douban';
  window.history.replaceState(null, '', '/douban?type=movie');
  view.rerender(
    <>
      <NavigationLink href='/douban?type=movie'>电影</NavigationLink>
      <NavigationProgress />
    </>
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it('allows clicking an already active category to retry without duplicating browser history', () => {
  const retry = jest.fn(),
    history = jest.spyOn(window.history, 'pushState');
  window.addEventListener('category-reselect', retry);
  render(<NavigationLink href='/douban?type=movie'>电影</NavigationLink>);
  fireEvent.click(screen.getByRole('link'));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(history).not.toHaveBeenCalled();
  window.removeEventListener('category-reselect', retry);
});
