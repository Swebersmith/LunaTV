import { act, fireEvent, render, screen } from '@testing-library/react';

import { useLongPress } from './useLongPress';

const click = jest.fn(),
  long = jest.fn();
function Harness() {
  const props = useLongPress({ onLongPress: long, onClick: click });
  return (
    <a href='/play' {...props}>
      海报<span>播放图标</span>
    </a>
  );
}
const pointer = {
  pointerId: 1,
  pointerType: 'touch',
  isPrimary: true,
  button: 0,
  clientX: 10,
  clientY: 10,
};
const original = window.PointerEvent;
beforeAll(() => {
  window.PointerEvent = class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId || 1;
      this.pointerType = init.pointerType || 'touch';
      this.isPrimary = init.isPrimary !== false;
    }
  } as typeof PointerEvent;
});
afterAll(() => {
  window.PointerEvent = original;
});
beforeEach(() => {
  jest.useFakeTimers();
  click.mockReset();
  long.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

it('uses exactly one native click for a normal tap and does not cancel touch/pointer release', () => {
  render(<Harness />);
  const link = screen.getByRole('link');
  fireEvent.pointerDown(link, pointer);
  expect(fireEvent.pointerUp(link, pointer)).toBe(true);
  expect(click).not.toHaveBeenCalled();
  fireEvent.click(link, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
  expect(long).not.toHaveBeenCalled();
});

it('opens details once on a long press and consumes only its generated click', () => {
  render(<Harness />);
  const link = screen.getByRole('link');
  fireEvent.pointerDown(link, pointer);
  act(() => jest.advanceTimersByTime(501));
  fireEvent.pointerUp(link, pointer);
  expect(long).toHaveBeenCalledTimes(1);
  expect(fireEvent.click(link, { detail: 1 })).toBe(false);
  expect(click).not.toHaveBeenCalled();
  fireEvent.pointerDown(link, pointer);
  fireEvent.pointerUp(link, pointer);
  fireEvent.click(link, { detail: 1 });
  expect(click).toHaveBeenCalledTimes(1);
});

it.each(['move', 'cancel', 'leave'])(
  'does not play after %s and accepts the very next tap',
  (kind) => {
    render(<Harness />);
    const link = screen.getByRole('link');
    fireEvent.pointerDown(link, pointer);
    if (kind === 'move')
      fireEvent.pointerMove(link, { ...pointer, clientX: 60 });
    else if (kind === 'cancel') fireEvent.pointerCancel(link, pointer);
    else fireEvent.pointerLeave(link, pointer);
    act(() => jest.advanceTimersByTime(700));
    fireEvent.pointerUp(link, pointer);
    fireEvent.click(link, { detail: 1 });
    expect(long).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    fireEvent.pointerDown(link, pointer);
    fireEvent.pointerUp(link, pointer);
    fireEvent.click(link, { detail: 1 });
    expect(click).toHaveBeenCalledTimes(1);
  }
);

it('retains keyboard/mouse activation and clears a pending long press on unmount', () => {
  const view = render(<Harness />);
  const link = screen.getByRole('link');
  fireEvent.pointerDown(link, { ...pointer, pointerType: 'mouse' });
  act(() => jest.advanceTimersByTime(600));
  fireEvent.click(link, { detail: 1 });
  fireEvent.click(link, { detail: 0 });
  expect(click).toHaveBeenCalledTimes(2);
  expect(long).not.toHaveBeenCalled();
  fireEvent.pointerDown(link, pointer);
  view.unmount();
  act(() => jest.advanceTimersByTime(600));
  expect(long).not.toHaveBeenCalled();
});
