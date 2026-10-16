'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanResult } from '@/lib/types';
import { useCategoryFeed } from '@/hooks/useCategoryFeed';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

type CategoryType = 'movie' | 'tv' | 'show' | 'anime' | 'custom';
interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}
const emptyFilters = () => ({
  type: 'all',
  region: 'all',
  year: 'all',
  platform: 'all',
  label: 'all',
  sort: 'T',
});

function DoubanPageClient({
  type,
  customCategories,
}: {
  type: CategoryType;
  customCategories: CustomCategory[];
}) {
  const customType = customCategories.some(
    (category) => category.type === 'movie'
  )
    ? 'movie'
    : 'tv';
  const [primarySelection, setPrimarySelection] = useState(
    type === 'movie'
      ? '热门'
      : type === 'anime'
      ? '每日放送'
      : type === 'custom'
      ? customType
      : '最近热门'
  );
  const [secondarySelection, setSecondarySelection] = useState(
    type === 'tv'
      ? 'tv'
      : type === 'show'
      ? 'show'
      : type === 'custom'
      ? customCategories.find((category) => category.type === customType)
          ?.query || ''
      : '全部'
  );
  const [multiLevelValues, setMultiLevelValues] =
    useState<Record<string, string>>(emptyFilters);
  const [selectedWeekday, setSelectedWeekday] = useState(
    () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()]
  );
  const loadingRef = useRef<HTMLDivElement>(null);
  const skeletonData = Array.from({ length: 15 }, (_, index) => index);
  const fetchPage = useCallback(
    async (page: number, signal: AbortSignal) => {
      let data: DoubanResult;
      if (type === 'custom') {
        const category = customCategories.find(
          (item) =>
            item.type === primarySelection && item.query === secondarySelection
        );
        if (!category) return { list: [], hasMore: false };
        data = await getDoubanList(
          {
            tag: category.query,
            type: category.type,
            pageLimit: 25,
            pageStart: page * 25,
          },
          signal
        );
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendar = await GetBangumiCalendarData(signal);
        return {
          list: (
            calendar.find((item) => item.weekday.en === selectedWeekday)
              ?.items || []
          ).map((item) => ({
            id: item.id?.toString() || '',
            title: item.name_cn || item.name,
            poster:
              item.images?.large ||
              item.images?.common ||
              item.images?.medium ||
              item.images?.small ||
              item.images?.grid ||
              '',
            rate: item.rating?.score?.toFixed(1) || '',
            year: item.air_date?.split('-')[0] || '',
          })),
          hasMore: false,
        };
      } else if (type === 'anime' || primarySelection === '全部') {
        data = await getDoubanRecommends(
          {
            kind:
              type === 'anime'
                ? primarySelection === '番剧'
                  ? 'tv'
                  : 'movie'
                : type === 'show'
                ? 'tv'
                : type,
            pageLimit: 25,
            pageStart: page * 25,
            category: type === 'anime' ? '动画' : multiLevelValues.type || '',
            format:
              type === 'anime'
                ? primarySelection === '番剧'
                  ? '电视剧'
                  : ''
                : type === 'show'
                ? '综艺'
                : type === 'tv'
                ? '电视剧'
                : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          },
          signal
        );
      } else {
        data = await getDoubanCategories(
          {
            kind: type === 'movie' ? 'movie' : 'tv',
            category: type === 'movie' ? primarySelection : type,
            type: secondarySelection,
            pageLimit: 25,
            pageStart: page * 25,
          },
          signal
        );
      }
      if (data.code !== 200 || !Array.isArray(data.list))
        throw new Error(data.message || '内容加载失败，请重试。');
      return { list: data.list };
    },
    [
      type,
      primarySelection,
      secondarySelection,
      multiLevelValues,
      selectedWeekday,
      customCategories,
    ]
  );
  const {
    items: doubanData,
    loading,
    loadingMore: isLoadingMore,
    error,
    moreError,
    hasMore,
    loadMore,
    retry,
  } = useCategoryFeed(fetchPage);

  useEffect(() => {
    if (
      !hasMore ||
      loading ||
      isLoadingMore ||
      moreError ||
      !loadingRef.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '100px' }
    );
    observer.observe(loadingRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [hasMore, loading, isLoadingMore, moreError, loadMore]);
  useEffect(() => {
    const reselect = () => {
      if (error) retry();
    };
    window.addEventListener('category-reselect', reselect);
    return () => window.removeEventListener('category-reselect', reselect);
  }, [error, retry]);
  const handlePrimaryChange = (value: string) => {
    if (value === primarySelection) {
      if (error) retry();
      return;
    }
    setPrimarySelection(value);
    setMultiLevelValues(emptyFilters());
    if (type === 'custom')
      setSecondarySelection(
        customCategories.find((category) => category.type === value)?.query ||
          ''
      );
    else if ((type === 'tv' || type === 'show') && value === '最近热门')
      setSecondarySelection(type);
  };
  const handleSecondaryChange = (value: string) => {
    if (value === secondarySelection) {
      if (error) retry();
    } else setSecondarySelection(value);
  };
  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      setMultiLevelValues((previous) =>
        JSON.stringify(previous) === JSON.stringify(values) ? previous : values
      );
    },
    []
  );
  const handleWeekdayChange = useCallback(
    (weekday: string) => setSelectedWeekday(weekday),
    []
  );
  const getPageTitle = () => {
    // 根据 type 生成标题
    return type === 'movie'
      ? '电影'
      : type === 'tv'
      ? '电视剧'
      : type === 'anime'
      ? '动漫'
      : type === 'show'
      ? '综艺'
      : '自定义';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '来自 Bangumi 番组计划的精选内容';
    }
    return '来自豆瓣的精选内容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题和选择器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 页面标题 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 选择器组件 */}
          {type !== 'custom' ? (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
              />
            </div>
          ) : (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            </div>
          )}
        </div>

        {/* 内容展示区域 */}
        <div
          className='max-w-[95%] mx-auto mt-8 overflow-visible'
          aria-busy={loading}
        >
          {loading && (
            <p
              role='status'
              className='mb-4 text-sm text-gray-500 dark:text-gray-400'
            >
              正在加载分类内容…
            </p>
          )}
          {error && (
            <div
              role='alert'
              className='mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
            >
              <p>{error}</p>
              <button
                type='button'
                onClick={retry}
                className='mt-3 rounded-lg bg-red-500 px-5 py-2 font-semibold text-white'
              >
                重新加载
              </button>
            </div>
          )}
          {/* 内容网格 */}
          {loading ? (
            // 显示骨架屏
            <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>
          ) : (
            // 显示实际数据
            <VirtualGrid
              items={doubanData}
              className='grid-cols-3 gap-x-2 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8'
              rowGapClass='pb-12 sm:pb-20'
              estimateRowHeight={320}
              renderItem={(item, index) => (
                <div key={`${item.title}-${index}`} className='w-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''} // 电影类型严格控制，tv 不控
                    isBangumi={
                      type === 'anime' && primarySelection === '每日放送'
                    }
                  />
                </div>
              )}
            />
          )}

          {hasMore && !loading && !error && (
            <div
              ref={loadingRef}
              className='mt-10 flex flex-col items-center gap-3 py-6'
            >
              {moreError && (
                <p
                  role='alert'
                  className='text-sm text-red-600 dark:text-red-400'
                >
                  {moreError}
                </p>
              )}
              <button
                type='button'
                disabled={isLoadingMore}
                onClick={() => void loadMore(!!moreError)}
                className='rounded-full border border-gray-300 px-5 py-2 text-sm text-gray-700 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200'
              >
                {isLoadingMore
                  ? '正在加载…'
                  : moreError
                  ? '重试加载更多'
                  : '加载更多'}
              </button>
            </div>
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-gray-500 py-8'>已加载全部内容</div>
          )}

          {/* 空状态 */}
          {!loading && !error && doubanData.length === 0 && (
            <div className='text-center text-gray-500 py-8'>暂无相关内容</div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function DoubanRoute() {
  const params = useSearchParams();
  const requested = params.get('type') || 'movie';
  const type: CategoryType = [
    'movie',
    'tv',
    'show',
    'anime',
    'custom',
  ].includes(requested)
    ? (requested as CategoryType)
    : 'movie';
  const [categories, setCategories] = useState<CustomCategory[] | null>(null);
  useEffect(() => {
    const runtime = window as Window & {
      RUNTIME_CONFIG?: { CUSTOM_CATEGORIES?: CustomCategory[] };
    };
    setCategories(runtime.RUNTIME_CONFIG?.CUSTOM_CATEGORIES || []);
  }, []);
  if (!categories)
    return (
      <PageLayout activePath={'/douban?type=' + type}>
        <p className='p-8 text-sm text-gray-500' role='status'>
          正在打开分类…
        </p>
      </PageLayout>
    );
  // A category change gets a fresh filter and request lifecycle immediately.
  return (
    <DoubanPageClient key={type} type={type} customCategories={categories} />
  );
}
export default function DoubanPage() {
  return (
    <Suspense
      fallback={
        <p className='p-8 text-sm text-gray-500' role='status'>
          正在打开分类…
        </p>
      }
    >
      <DoubanRoute />
    </Suspense>
  );
}
