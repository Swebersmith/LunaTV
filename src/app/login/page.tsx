/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { BRAND_TAGLINE } from '@/lib/branding';

import { BrandLogo } from '@/components/BrandLogo';
import { SquadColors, SquadIllustration } from '@/components/CrayonTheme';
import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='crayon-login'>
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='crayon-login-layout'>
        <section
          className='crayon-login-poster'
          aria-label='春日部防卫队观影俱乐部'
        >
          <span className='crayon-badge'>
            <SquadColors /> KASUKABE MOVIE CLUB
          </span>
          <h2>
            快乐这件事，
            <br />
            <span>一起就对了。</span>
          </h2>
          <p>
            小新和朋友们已经就位。
            <br />
            今天的好故事，就差一个你。
          </p>
          <div className='crayon-login-illustration'>
            <SquadIllustration priority />
          </div>
          <span className='crayon-ticket'>
            一张通往好心情的电影票 <span aria-hidden='true'>✦</span>
          </span>
        </section>
        <div className='crayon-login-card'>
          <div className='mb-8 flex flex-col items-center text-center'>
            <BrandLogo size={76} priority className='mb-3 drop-shadow-sm' />
            <h1 className='crayon-wordmark text-4xl font-black tracking-tight text-red-600 dark:text-amber-300'>
              {siteName}
            </h1>
            <p className='mt-3 text-sm leading-relaxed text-stone-500 dark:text-stone-400'>
              {BRAND_TAGLINE}
            </p>
          </div>
          <form onSubmit={handleSubmit} className='space-y-5'>
            {shouldAskUsername && (
              <div>
                <label htmlFor='username' className='crayon-field-label'>
                  用户名
                </label>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-red-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                  placeholder='输入用户名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}

            <div>
              <label htmlFor='password' className='crayon-field-label'>
                密码
              </label>
              <input
                id='password'
                type='password'
                autoComplete='current-password'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-red-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder='输入访问密码'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
            )}

            {/* 登录按钮 */}
            <button
              type='submit'
              disabled={
                !password || loading || (shouldAskUsername && !username)
              }
              className='crayon-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50'
            >
              {loading ? '登录中...' : '登录，开始放映'}
            </button>
          </form>
          <div className='mt-7 flex justify-center'>
            <SquadColors />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
