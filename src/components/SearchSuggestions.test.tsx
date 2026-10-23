import { act, fireEvent, render, screen } from '@testing-library/react';

import SearchSuggestions from './SearchSuggestions';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('selects a suggestion once without also submitting the enclosing search form', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ suggestions: [{ text: '唐朝诡事录' }] }),
  });
  const select = jest.fn();
  const submit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <SearchSuggestions
        query='唐朝'
        isVisible
        onSelect={select}
        onClose={jest.fn()}
      />
    </form>
  );
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  fireEvent.click(screen.getByRole('button', { name: '唐朝诡事录' }));
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith('唐朝诡事录');
  expect(submit).not.toHaveBeenCalled();
});

it('does not let a cancelled request failure remove the current clickable suggestions', async () => {
  let rejectOld: (reason: Error) => void = () => undefined;
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        })
    )
    .mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [{ text: '新片名' }] }),
    });
  const props = { isVisible: true, onSelect: jest.fn(), onClose: jest.fn() };
  const view = render(<SearchSuggestions {...props} query='旧' />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  view.rerender(<SearchSuggestions {...props} query='新' />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.getByRole('button', { name: '新片名' })).toBeInTheDocument();
  await act(async () => {
    rejectOld(new Error('network failed after cancellation'));
  });
  fireEvent.click(screen.getByRole('button', { name: '新片名' }));
  expect(props.onSelect).toHaveBeenCalledWith('新片名');
});
