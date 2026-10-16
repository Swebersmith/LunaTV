import { ArrowRight, Search, Sparkles } from 'lucide-react';
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
    <section className='crayon-hero' aria-labelledby='squad-hero-title'>
      <div className='crayon-hero-copy'>
        <span className='crayon-badge'>
          <SquadColors /> 春日部防卫队的放映时间
        </span>
        <h1 id='squad-hero-title'>
          今天，也要
          <br />
          <span>快乐放映！</span>
        </h1>
        <p>
          带上零食和好心情，和小新他们一起，
          <br className='hidden sm:block' />
          寻找下一部让你舍不得关掉的好片。
        </p>
        <div className='crayon-hero-actions'>
          <Link href='/search' className='crayon-button'>
            <Search size={17} /> 搜索好片 <ArrowRight size={17} />
          </Link>
          <Link href='/douban?type=anime' className='crayon-secondary-link'>
            去看动漫 <Sparkles size={16} />
          </Link>
        </div>
      </div>
      <div className='crayon-hero-art'>
        <span className='crayon-sun' aria-hidden='true' />
        <span className='crayon-art-label' aria-hidden='true'>
          MOVIE TIME!
        </span>
        <SquadIllustration priority />
      </div>
    </section>
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
