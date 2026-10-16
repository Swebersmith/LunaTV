import Image from 'next/image';
import Link from 'next/link';

import { SQUAD_IMAGE_URL } from '@/lib/branding';

export function SquadColors() {
  return (
    <span className='squad-colors' aria-hidden='true'>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function SquadIllustration({
  className = '',
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={SQUAD_IMAGE_URL}
      alt='小新、风间、妮妮、正男、阿呆和小白一起吃爆米花看电影'
      width={1200}
      height={800}
      priority={priority}
      className={`h-auto w-full object-contain ${className}`}
    />
  );
}

export function SquadHero() {
  return (
    <Link
      href='/shinchan'
      className='crayon-hero'
      aria-label='进入蜡笔小新专区'
    >
      <div className='crayon-hero-art'>
        <SquadIllustration priority />
      </div>
    </Link>
  );
}

export function CrayonFooter() {
  return (
    <footer className='crayon-footer'>
      <SquadColors />
      <span>春日部防卫队 · 把平凡的日子看成一场冒险</span>
    </footer>
  );
}
