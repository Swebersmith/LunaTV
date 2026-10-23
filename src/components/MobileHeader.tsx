'use client';

import { BackButton } from './BackButton';
import { BrandLogo } from './BrandLogo';
import NavigationLink from './NavigationLink';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className='crayon-mobile-header md:hidden fixed top-0 left-0 right-0 z-[999] w-full backdrop-blur-xl border-b'>
      <div className='crayon-mobile-header-layout'>
        {/* 左侧：搜索按钮、返回按钮和设置按钮 */}
        <div className='flex items-center gap-1'>
          <NavigationLink
            href='/search'
            aria-label='搜索影片'
            className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          >
            <svg
              className='w-full h-full'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
              />
            </svg>
          </NavigationLink>
          {showBackButton && <BackButton />}
        </div>

        <NavigationLink
          href='/'
          aria-label={siteName}
          title={siteName}
          className='crayon-mobile-brand crayon-wordmark flex min-w-0 items-center font-black text-red-600 hover:opacity-80 transition-opacity dark:text-amber-300'
        >
          <BrandLogo size={24} />
          <span className='min-w-0 truncate'>{siteName}</span>
        </NavigationLink>

        {/* 右侧按钮 */}
        <div className='flex items-center justify-end gap-1'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
