import {
  MouseEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  longPressDelay?: number;
  moveThreshold?: number;
}

export const useLongPress = ({
  onLongPress,
  onClick,
  longPressDelay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    active.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const isControl = (
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>
  ) => {
    const control = (event.target as Element).closest(
      'a, button, input, select, textarea, [role="button"], [data-button]'
    );
    return !!control && control !== event.currentTarget;
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      clear();
      suppressClick.current = false;
      if (event.isPrimary === false) {
        suppressClick.current = true;
        return;
      }
      if (
        event.pointerType === 'mouse' ||
        event.button !== 0 ||
        isControl(event)
      )
        return;
      active.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      timer.current = setTimeout(() => {
        if (!active.current) return;
        suppressClick.current = true;
        onLongPress();
        try {
          navigator.vibrate?.(50);
        } catch {
          /* Haptics are optional. */
        }
      }, longPressDelay);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = active.current;
      if (!start || start.id !== event.pointerId) return;
      if (
        Math.hypot(event.clientX - start.x, event.clientY - start.y) >
        moveThreshold
      ) {
        suppressClick.current = true;
        clear();
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (active.current?.id === event.pointerId) clear();
    },
    onPointerCancel: () => {
      suppressClick.current = true;
      clear();
    },
    onPointerLeave: () => {
      if (!active.current) return;
      suppressClick.current = true;
      clear();
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (isControl(event)) return;
      // Normal taps use the browser's single click. Consume only the click
      // produced by a long press/drag; keyboard activation remains available.
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      suppressClick.current = false;
      onClick?.();
    },
  };
};
