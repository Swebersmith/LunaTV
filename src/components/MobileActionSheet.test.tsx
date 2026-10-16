import { act, fireEvent, render, screen } from '@testing-library/react';

import MobileActionSheet from './MobileActionSheet';

describe('video detail action sheet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('escapes transformed virtual rows and prevents action clicks reaching the page', () => {
    const pageClick = jest.fn();
    const play = jest.fn();
    const close = jest.fn();
    const { container } = render(
      <div style={{ transform: 'translateY(320px)' }} onClick={pageClick}>
        <MobileActionSheet
          isOpen
          onClose={close}
          title='测试影片'
          actions={[{ id: 'play', label: '播放', icon: null, onClick: play }]}
        />
      </div>
    );

    const dialog = screen.getByRole('dialog', { name: '测试影片' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(pageClick).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside the sheet and restores focus and scroll styles after closing', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const originalOverflow = document.body.style.overflow;
    const close = jest.fn();
    const props = {
      title: '测试影片',
      onClose: close,
      actions: [{ id: 'play', label: '播放', icon: null, onClick: jest.fn() }],
    };
    const { rerender, unmount } = render(
      <MobileActionSheet {...props} isOpen />
    );

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '播放' })
    );
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '关闭详情' })
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);

    rerender(<MobileActionSheet {...props} isOpen={false} />);
    act(() => jest.advanceTimersByTime(250));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(document.activeElement).toBe(trigger);
    unmount();
    trigger.remove();
  });

  it('ignores disabled actions and closes when the full-screen backdrop is clicked', () => {
    const action = jest.fn();
    const close = jest.fn();
    render(
      <MobileActionSheet
        isOpen
        onClose={close}
        title='测试影片'
        actions={[
          {
            id: 'wait',
            label: '加载中',
            icon: null,
            onClick: action,
            disabled: true,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '加载中' }));
    expect(action).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    const backdrop = document.querySelector('[data-video-action-backdrop]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
