import { fireEvent, render, screen } from '@testing-library/react';

import { BackButton } from './BackButton';

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
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
  });

  afterEach(() => {
    if (historyLength) {
      Object.defineProperty(window.history, 'length', historyLength);
    }
    jest.restoreAllMocks();
  });

  it('returns to the home page when a playback link has no history entry', () => {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 1,
    });
    const nativeBack = jest.spyOn(window.history, 'back').mockImplementation();

    render(<BackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mockRouterPush).toHaveBeenCalledWith('/');
    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(nativeBack).not.toHaveBeenCalled();
  });

  it('uses the application history when a prior page exists', () => {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 2,
    });

    render(<BackButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
