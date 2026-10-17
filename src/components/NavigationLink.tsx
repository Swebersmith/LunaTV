'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ComponentProps, useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let pending: {
  href: string;
  from: string;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const snapshot = () => pending?.href || '';
const serverSnapshot = () => '';
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => Array.from(listeners).forEach((listener) => listener());

function cancelNavigation() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
  notify();
}

function beginNavigation(href: string) {
  const from = window.location.pathname + window.location.search;
  if (href === from) {
    cancelNavigation();
    return true;
  }
  if (pending?.href === href && pending.from === from) return false;
  cancelNavigation();
  pending = {
    href,
    from,
    timer: setTimeout(() => {
      if (pending?.href !== href) return;
      cancelNavigation();
      // Recover if a soft navigation never commits (for example, a stalled RSC request).
      if (window.location.pathname + window.location.search === from)
        window.location.assign(href);
    }, 8000),
  };
  notify();
  return true;
}

export function navigateWithFallback(
  href: string,
  push: (href: string) => void
) {
  if (!beginNavigation(href)) return;
  try {
    push(href);
  } catch {
    cancelNavigation();
    window.location.assign(href);
  }
}

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

export default function NavigationLink({
  href,
  onClick,
  children,
  ...props
}: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pendingHref = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    const current = window.location.pathname + window.location.search;
    if (pending && (current === pending.href || current !== pending.from))
      cancelNavigation();
  }, [pathname, params]);

  return (
    <Link
      {...props}
      prefetch={
        pathname === '/douban' && href.startsWith('/douban?')
          ? false
          : props.prefetch
      }
      href={href}
      aria-busy={pendingHref === href || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (props.target && props.target !== '_self') ||
          props.download
        )
          return;
        if (pathname === '/douban' && href.startsWith('/douban?')) {
          cancelNavigation();
          event.preventDefault();
          if (window.location.pathname + window.location.search !== href)
            window.history.pushState(null, '', href);
          else window.dispatchEvent(new Event('category-reselect'));
          if (props.scroll !== false) window.scrollTo(0, 0);
          return;
        }
        if (!beginNavigation(href)) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}

export function NavigationProgress() {
  const href = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    window.addEventListener('popstate', cancelNavigation);
    return () => window.removeEventListener('popstate', cancelNavigation);
  }, []);
  if (!href) return null;
  return (
    <div
      role='status'
      className='pointer-events-none fixed inset-x-0 top-0 z-[1100] h-1 overflow-hidden bg-red-100'
    >
      <div className='h-full w-full animate-pulse bg-red-500' />
      <span className='sr-only'>正在打开页面…</span>
    </div>
  );
}
