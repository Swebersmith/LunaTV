'use client';

import { useEffect, useState } from 'react';

// Mount on the opening render, retaining only the closing content briefly.
export function useMotionPresence(open: boolean, duration = 160) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRetained(false);
      return;
    }
    const timer = setTimeout(() => setRetained(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration, retained]);
  return { present: open || retained, state: open ? 'open' : 'closed' } as const;
}
