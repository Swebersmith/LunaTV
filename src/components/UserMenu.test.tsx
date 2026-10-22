import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';

import { prefetchAdminConfig } from '@/lib/admin-config-client';

import { UserMenu } from './UserMenu';

const mockPrefetch = jest.fn();
let mockRole = 'owner';
jest.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: mockPrefetch }) }));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromBrowserCookie: () => ({ username: 'test', role: mockRole }) }));
jest.mock('@/lib/admin-config-client', () => ({ prefetchAdminConfig: jest.fn(), clearAdminConfigPrefetch: jest.fn() }));
jest.mock('@/components/NavigationLink', () => ({
  __esModule: true,
  default: ({ prefetch: _prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} />,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRole = 'owner';
  localStorage.clear();
});
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

it('opens local settings immediately with saved preferences and saves edits', () => {
  localStorage.setItem('defaultAggregateSearch', 'false');
  render(<UserMenu />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('dialog', { name: '本地设置' })).toHaveFocus();
  const aggregate = screen.getByRole('checkbox', { name: '默认聚合搜索结果' });
  expect(aggregate).not.toBeChecked();
  fireEvent.click(aggregate);
  expect(localStorage.getItem('defaultAggregateSearch')).toBe('true');
  expect(document.body.style.overflow).toBe('hidden');
  act(() => jest.advanceTimersByTime(160));
  fireEvent.keyDown(document, { key: 'Escape' });
  act(() => jest.advanceTimersByTime(160));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(screen.getByRole('button', { name: '用户菜单' })).toHaveFocus();
});

it('prepares admin navigation on intent and offers a native link', () => {
  render(<UserMenu />);
  expect(prefetchAdminConfig).not.toHaveBeenCalled();
  fireEvent.pointerEnter(screen.getByRole('button', { name: '用户菜单' }));
  expect(mockPrefetch).toHaveBeenCalledWith('/admin');
  expect(prefetchAdminConfig).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
  expect(screen.getByRole('link', { name: '管理面板' })).toHaveAttribute('href', '/admin');
});

it('keeps administrator requests and entries out of regular-user menus', () => {
  mockRole = 'user';
  render(<UserMenu />);
  fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
  expect(screen.queryByRole('link', { name: '管理面板' })).toBeNull();
  expect(prefetchAdminConfig).not.toHaveBeenCalled();
});

it('can reopen during the closing animation without losing the dialog', () => {
  render(<UserMenu />);
  const trigger = screen.getByRole('button', { name: '用户菜单' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  act(() => jest.advanceTimersByTime(300));
  expect(screen.getByRole('dialog', { name: '本地设置' })).toBeVisible();
});
