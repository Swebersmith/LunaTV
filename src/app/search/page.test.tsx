import { act, fireEvent, render, screen } from '@testing-library/react';

import { useVideoSearch } from '@/hooks/useVideoSearch';

import SearchPage from './page';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('@/hooks/useVideoSearch', () => ({
  useVideoSearch: jest.fn(() => ({
    results: [],
    loading: false,
    streaming: false,
    totalSources: 0,
    completedSources: 0,
    error: null,
    notice: null,
  })),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
jest.mock('@/components/SearchSuggestions', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/lib/db.client', () => ({
  addSearchHistory: jest.fn().mockResolvedValue(undefined),
  getSearchHistory: jest.fn().mockResolvedValue([]),
  subscribeToDataUpdates: () => () => undefined,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(useVideoSearch).mockClear();
  window.history.replaceState(null, '', '/search');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('updates the search URL immediately, normalizes input and allows retrying the same query', async () => {
  const history = jest.spyOn(window.history, 'pushState');
  const view = render(<SearchPage />);
  const input = screen.getByRole('textbox', { name: '搜索电影、电视剧或动漫' });
  fireEvent.change(input, { target: { value: '  唐朝   诡事录 & 2  ' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(history).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(window.location.search).get('q')).toBe(
    '唐朝 诡事录 & 2'
  );
  // Next's patched history API normally re-renders useSearchParams here.
  view.rerender(<SearchPage />);
  expect(useVideoSearch).toHaveBeenLastCalledWith('唐朝 诡事录 & 2', 0);
  expect(input).toHaveValue('唐朝 诡事录 & 2');
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(useVideoSearch).toHaveBeenLastCalledWith('唐朝 诡事录 & 2', 1);
  expect(history).toHaveBeenCalledTimes(1);
  window.history.replaceState(null, '', '/search');
  view.rerender(<SearchPage />);
  expect(input).toHaveValue('');
  expect(
    screen.getByRole('heading', { name: '下一部好片，藏在哪里？' })
  ).toBeInTheDocument();
  await act(async () => undefined);
});

it('does not submit while the Chinese input method is composing', async () => {
  const history = jest.spyOn(window.history, 'pushState');
  render(<SearchPage />);
  const input = screen.getByRole('textbox', { name: '搜索电影、电视剧或动漫' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '唐' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(history).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(history).toHaveBeenCalledTimes(1);
  await act(async () => undefined);
});
