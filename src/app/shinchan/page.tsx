import type { Metadata } from 'next';
import { Suspense } from 'react';

import ShinchanCollection from '@/components/ShinchanCollection';

export const metadata: Metadata = {
  title: '蜡笔小新专区 | CrayonTV',
  description:
    '蜡笔小新电视动画全季与历年剧场版，按季、年份与语言版本选择观看。',
};

export default function ShinchanPage() {
  return (
    <Suspense
      fallback={<div className='p-8 text-center'>正在整理小新的放映清单…</div>}
    >
      <ShinchanCollection />
    </Suspense>
  );
}
