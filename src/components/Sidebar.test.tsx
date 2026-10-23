import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnchorHTMLAttributes } from 'react';

import { NavigationProgress } from './NavigationLink';
import Sidebar from './Sidebar';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => window.location.pathname,
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
        if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey)
          mockPush(href);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
jest.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
jest.mock('./CrayonTheme', () => ({ SquadColors: () => null }));

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  localStorage.clear();
  window.history.replaceState(null, '', '/douban?type=movie');
  const reset = render(<NavigationProgress />);
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  reset.unmount();
});

afterEach(() => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  jest.useRealTimers();
});

it.each(['首页', '搜索'])(
  'gives %s navigation immediate feedback and a recovery deadline',
  (name) => {
    render(
      <>
        <Sidebar activePath='/douban?type=movie' />
        <NavigationProgress />
      </>
    );
    const link = screen.getByRole('link', { name });
    fireEvent.click(link);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('正在打开页面');
    expect(jest.getTimerCount()).toBe(1);
    // The selected entry continues to describe the committed page while loading.
    expect(link).toHaveAttribute('data-active', 'false');
  }
);

it('preserves modified search clicks and replaces a pending home navigation with search', () => {
  render(
    <>
      <Sidebar activePath='/douban?type=movie' />
      <NavigationProgress />
    </>
  );
  const search = screen.getByRole('link', { name: '搜索' });
  fireEvent.click(search, { ctrlKey: true });
  expect(mockPush).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  fireEvent.click(screen.getByRole('link', { name: '首页' }));
  fireEvent.click(search);
  expect(mockPush).toHaveBeenLastCalledWith('/search');
  expect(search).toHaveAttribute('aria-busy', 'true');
  expect(jest.getTimerCount()).toBe(1);
});
