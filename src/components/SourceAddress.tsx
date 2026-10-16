'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export default function SourceAddress({
  value,
  label,
}: {
  value?: string;
  label: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );

  if (!value) return <span className='text-gray-400'>—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className='source-address'>
      <div className='flex min-w-0 items-start gap-2'>
        <code className='source-address-value flex-1 select-text text-gray-700 dark:text-gray-300'>
          {value}
        </code>
        <button
          type='button'
          onClick={copy}
          aria-label={`复制${label}`}
          title={`复制${label}`}
          className='shrink-0 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-red-400'
        >
          {copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <span
        role='status'
        className='block text-xs text-gray-500 dark:text-gray-400'
      >
        {copyState === 'copied' && '已复制'}
        {copyState === 'failed' && '复制失败，请长按或选中地址复制'}
      </span>
    </div>
  );
}
