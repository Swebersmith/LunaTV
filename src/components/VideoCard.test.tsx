/* eslint-disable @next/next/no-img-element */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';

import { saveFavorite } from '@/lib/db.client';

import { NavigationProgress } from './NavigationLink';
import VideoCard from './VideoCard';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    onLoadingComplete: _complete,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    onLoadingComplete?: unknown;
  }) => <img {...props} alt={props.alt} />,
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
        if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey)
          mockPush(href);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
jest.mock('@/lib/utils', () => ({
  processImageUrl: (url: string) => url || '/poster.png',
}));
jest.mock('@/lib/db.client', () => ({
  isFavorited: jest.fn().mockResolvedValue(false),
  subscribeToDataUpdates: () => () => undefined,
  generateStorageKey: (a: string, b: string) => a + '+' + b,
  saveFavorite: jest.fn().mockResolvedValue(undefined),
  deleteFavorite: jest.fn(),
  deletePlayRecord: jest.fn(),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  jest.mocked(saveFavorite).mockClear();
  window.history.replaceState(null, '', '/search?q=movie');
});
afterEach(() => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  jest.useRealTimers();
});

it('provides one real link across the poster, preserves encoded identities and starts navigation feedback', () => {
  render(
    <>
      <VideoCard
        from='search'
        title='影片 A'
        source='s&one'
        id='id/1?x=2'
        query='movie'
        year='2026'
      />
      <NavigationProgress />
    </>
  );
  const link = screen.getByRole('link', { name: '播放 影片 A' });
  const url = new URL(link.getAttribute('href') || '', window.location.origin);
  expect(url.searchParams.get('source')).toBe('s&one');
  expect(url.searchParams.get('id')).toBe('id/1?x=2');
  expect(url.searchParams.get('returnTo')).toBe('/search?q=movie');
  expect(link.querySelector('a')).toBeNull();
  fireEvent.click(link, { detail: 1 });
  fireEvent.click(link, { detail: 1 });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(link).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
});

it('retains modified clicks and the title-search and live-card targets', async () => {
  const view = render(
    <VideoCard
      from='douban'
      title=' 测试片 '
      year='2026'
      type='movie'
      isAggregate
    />
  );
  let link = screen.getByRole('link', { name: '播放 测试片' });
  let url = new URL(link.getAttribute('href') || '', window.location.origin);
  expect(url.pathname).toBe('/play');
  expect(url.searchParams.get('title')).toBe('测试片');
  expect(url.searchParams.get('prefer')).toBe('true');
  const timersBeforeClick = jest.getTimerCount();
  fireEvent.click(link, { ctrlKey: true });
  expect(mockPush).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(timersBeforeClick);
  view.rerender(
    <VideoCard
      from='favorite'
      title='CCTV1'
      source='live_s&1'
      id='live_c+1'
      origin='live'
    />
  );
  link = screen.getByRole('link', { name: '播放 CCTV1' });
  url = new URL(link.getAttribute('href') || '', window.location.origin);
  expect(url.pathname).toBe('/live');
  expect(url.searchParams.get('source')).toBe('s&1');
  expect(url.searchParams.get('id')).toBe('c+1');
  await act(async () => undefined);
});

it('keeps favorite and right-click details separate from playback', async () => {
  render(<VideoCard from='favorite' title='影片' source='s' id='1' />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '添加收藏' })).toBeInTheDocument()
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '添加收藏' }));
  });
  await waitFor(() => expect(saveFavorite).toHaveBeenCalledTimes(1));
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByRole('link', { name: '播放 影片' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^播放$/ }));
  expect(mockPush).toHaveBeenCalledTimes(1);
});
