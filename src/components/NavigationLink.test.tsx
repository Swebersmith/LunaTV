import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnchorHTMLAttributes } from 'react';

import NavigationLink, {
  navigateWithFallback,
  NavigationProgress,
} from './NavigationLink';

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
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean | null;
  }) => (
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
  // Reset shared navigation state through its public browser event, even when
  // the previous test unmounted its progress observer before cleanup ran.
  const reset = render(<NavigationProgress />);
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  reset.unmount();
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

it('does not restart the recovery deadline or issue duplicate pushes when a link is clicked repeatedly', () => {
  mockPath = '/';
  window.history.replaceState(null, '', '/');
  render(<NavigationLink href='/play?title=test'>播放</NavigationLink>);
  fireEvent.click(screen.getByRole('link'));
  act(() => jest.advanceTimersByTime(3000));
  fireEvent.click(screen.getByRole('link'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(1);
});

it('cancels an outstanding recovery when the user chooses the current page', () => {
  mockPath = '/';
  window.history.replaceState(null, '', '/');
  render(
    <>
      <NavigationLink href='/play?title=test'>播放</NavigationLink>
      <NavigationLink href='/'>首页</NavigationLink>
      <NavigationProgress />
    </>
  );
  fireEvent.click(screen.getByRole('link', { name: '播放' }));
  expect(jest.getTimerCount()).toBe(1);
  fireEvent.click(screen.getByRole('link', { name: '首页' }));
  expect(jest.getTimerCount()).toBe(0);
  expect(screen.queryByRole('status')).toBeNull();
  expect(mockPush).toHaveBeenLastCalledWith('/');
});

it('clears a search query through client history and cancels an older pending navigation', () => {
  mockPath = '/search';
  window.history.replaceState(null, '', '/search?q=old');
  const history = jest.spyOn(window.history, 'pushState');
  render(
    <>
      <NavigationLink href='/play?title=old'>播放</NavigationLink>
      <NavigationLink href='/search'>搜索</NavigationLink>
      <NavigationProgress />
    </>
  );
  fireEvent.click(screen.getByRole('link', { name: '播放' }));
  fireEvent.click(screen.getByRole('link', { name: '搜索' }));
  expect(history).toHaveBeenCalledWith(null, '', '/search');
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it('uses a full navigation when the latest route stays stalled and cancels superseded recovery timers', () => {
  const originalLocation = window.location;
  const assign = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/douban', search: '?type=movie', assign },
  });
  try {
    render(
      <>
        <NavigationLink href='/'>首页</NavigationLink>
        <NavigationLink href='/search'>搜索</NavigationLink>
        <NavigationProgress />
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: '首页' }));
    act(() => jest.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('link', { name: '搜索' }));
    act(() => jest.advanceTimersByTime(5000));
    expect(assign).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(3000));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/search');
    expect(screen.queryByRole('status')).toBeNull();
    act(() =>
      navigateWithFallback('/', () => {
        throw new Error('router unavailable');
      })
    );
    expect(assign).toHaveBeenLastCalledWith('/');
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  }
});

it('discards an in-flight route when the current search entry is selected again', () => {
  mockPath = '/search';
  window.history.replaceState(null, '', '/search');
  const replace = jest.spyOn(window.history, 'replaceState');
  render(
    <>
      <NavigationLink href='/'>首页</NavigationLink>
      <NavigationLink href='/search'>搜索</NavigationLink>
      <NavigationProgress />
    </>
  );
  fireEvent.click(screen.getByRole('link', { name: '首页' }));
  fireEvent.click(screen.getByRole('link', { name: '搜索' }));
  expect(replace).toHaveBeenCalledWith(null, '', '/search');
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(screen.queryByRole('status')).toBeNull();
});
