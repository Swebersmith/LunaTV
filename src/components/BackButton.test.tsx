import { fireEvent, render, screen } from '@testing-library/react';

import { BackButton } from './BackButton';

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
let mockReturnTo: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
  }),
  useSearchParams: () => ({
    get: (name: string) => (name === 'returnTo' ? mockReturnTo : null),
  }),
}));

describe('BackButton', () => {
  const historyLength = Object.getOwnPropertyDescriptor(
    window.history,
    'length'
  );

  beforeEach(() => {
    mockRouterBack.mockClear();
    mockRouterPush.mockClear();
    mockReturnTo = null;
  });

  afterEach(() => {
    if (historyLength) {
      Object.defineProperty(window.history, 'length', historyLength);
    }
    jest.restoreAllMocks();
  });

  it('returns to the home page when a direct playback link has no source page', () => {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 2,
    });

    render(<BackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mockRouterPush).toHaveBeenCalledWith('/');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('returns to the source page carried by a playback link', () => {
    mockReturnTo = '/search?q=%E7%BB%9D%E6%9C%9B%E5%86%99%E6%89%8B';
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 2,
    });

    render(<BackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/search?q=%E7%BB%9D%E6%9C%9B%E5%86%99%E6%89%8B'
    );
    expect(mockRouterBack).not.toHaveBeenCalled();
  });
});
