'use client';

import { ChevronDown } from 'lucide-react';
import { ReactNode, useId } from 'react';

import { useMotionPresence } from '@/hooks/useMotionPresence';

export default function CollapsibleTab({ title, icon, isExpanded, onToggle, children }: {
  title: string;
  icon?: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const { present, state } = useMotionPresence(isExpanded);
  return (
    <section className='motion-admin-section rounded-xl shadow-sm mb-4 overflow-hidden bg-white/90 dark:bg-gray-800/80 dark:ring-1 dark:ring-gray-700'>
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={id}
        className='w-full px-6 py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <span className='flex items-center gap-3'>
          {icon}
          <span className='text-lg font-medium text-gray-900 dark:text-gray-100'>{title}</span>
        </span>
        <ChevronDown size={20} className='motion-chevron text-gray-500 dark:text-gray-400' data-expanded={isExpanded} />
      </button>
      <div id={id} className='motion-disclosure' data-state={state} aria-hidden={!isExpanded}>
        <div className='min-h-0 overflow-hidden'>
          {present && <div className='px-6 py-4'>{children}</div>}
        </div>
      </div>
    </section>
  );
}
