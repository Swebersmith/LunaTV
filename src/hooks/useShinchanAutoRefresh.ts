'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const SHINCHAN_AUTO_REFRESH_MS = 15 * 60 * 1000;

export function useShinchanAutoRefresh() {
  const [revision, setRevision] = useState(0);
  const lastCheck = useRef(Date.now());
  const refresh = useCallback(() => {
    lastCheck.current = Date.now();
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const check = () => {
      if (
        document.visibilityState !== 'hidden' &&
        navigator.onLine !== false &&
        Date.now() - lastCheck.current >= SHINCHAN_AUTO_REFRESH_MS
      )
        refresh();
    };
    const reconnect = () => {
      if (document.visibilityState !== 'hidden') refresh();
    };
    const timer = setInterval(check, SHINCHAN_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', reconnect);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', reconnect);
    };
  }, [refresh]);
  return { revision, refresh };
}
