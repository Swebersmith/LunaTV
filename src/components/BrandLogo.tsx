import Image from 'next/image';

import { BRAND_LOGO_URL } from '@/lib/branding';

export function BrandLogo({
  size = 36,
  priority = false,
  className = '',
}: {
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={BRAND_LOGO_URL}
      width={size}
      height={size}
      alt=''
      aria-hidden='true'
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
