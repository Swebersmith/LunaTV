/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { Heart, Radio, Tv } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { nextLiveAlternative } from '@/lib/live-failover';
import { parseCustomTimeFormat } from '@/lib/time';

import EpgScrollableRow from '@/components/EpgScrollableRow';
import LivePlayer from '@/components/LivePlayer';
import PageLayout from '@/components/PageLayout';

// 直播频道接口
interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

// 直播源接口
interface LiveSource {
  key: string;
  name: string;
  url: string;  // m3u 地址
  ua?: string;
  epg?: string; // 节目单
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}

function LivePageClient() {
  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [loadingMessage, setLoadingMessage] = useState('正在加载直播源...');
  const [error, setError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // 直播源相关
  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const currentSourceRef = useRef<LiveSource | null>(null);
  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  // 频道相关
  const [currentChannels, setCurrentChannels] = useState<LiveChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(null);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const [needLoadSource] = useState(searchParams.get('source'));
  const [needLoadChannel] = useState(searchParams.get('id'));

  // 播放器相关
  const [videoUrl, setVideoUrl] = useState('');
  const [channelError, setChannelError] = useState('');
  const attemptedAddresses = useRef(new Set<string>());
  const [failoverMessage, setFailoverMessage] = useState('');
  const [selectionAttempt, setSelectionAttempt] = useState(0);
  const channelRequest = useRef<AbortController | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);

  // 切换直播源状态
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  // 分组相关
  const [groupedChannels, setGroupedChannels] = useState<{ [key: string]: LiveChannel[] }>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  // Tab 切换
  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>('channels');

  // 频道列表收起状态
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);

  // 过滤后的频道列表
  const [filteredChannels, setFilteredChannels] = useState<LiveChannel[]>([]);

  // 节目单信息
  const [epgData, setEpgData] = useState<{
    tvgId: string;
    source: string;
    epgUrl: string;
    programs: Array<{
      start: string;
      end: string;
      title: string;
    }>;
  } | null>(null);

  // EPG 数据加载状态
  const [isEpgLoading, setIsEpgLoading] = useState(false);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);
  const currentChannelRef = useRef<LiveChannel | null>(null);

  // EPG数据清洗函数 - 去除重叠的节目，保留时间较短的，只显示今日节目
  const cleanEpgData = (programs: Array<{ start: string; end: string; title: string }>) => {
    if (!programs || programs.length === 0) return programs;

    // 获取今日日期（只考虑年月日，忽略时间）
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // 首先过滤出今日的节目（包括跨天节目）
    const todayPrograms = programs.filter(program => {
      const programStart = parseCustomTimeFormat(program.start);
      const programEnd = parseCustomTimeFormat(program.end);

      // 获取节目的日期范围
      const programStartDate = new Date(programStart.getFullYear(), programStart.getMonth(), programStart.getDate());
      const programEndDate = new Date(programEnd.getFullYear(), programEnd.getMonth(), programEnd.getDate());

      // 如果节目的开始时间或结束时间在今天，或者节目跨越今天，都算作今天的节目
      return (
        (programStartDate >= todayStart && programStartDate < todayEnd) || // 开始时间在今天
        (programEndDate >= todayStart && programEndDate < todayEnd) || // 结束时间在今天
        (programStartDate < todayStart && programEndDate >= todayEnd) // 节目跨越今天（跨天节目）
      );
    });

    // 按开始时间排序
    const sortedPrograms = [...todayPrograms].sort((a, b) => {
      const startA = parseCustomTimeFormat(a.start).getTime();
      const startB = parseCustomTimeFormat(b.start).getTime();
      return startA - startB;
    });

    const cleanedPrograms: Array<{ start: string; end: string; title: string }> = [];

    for (let i = 0; i < sortedPrograms.length; i++) {
      const currentProgram = sortedPrograms[i];
      const currentStart = parseCustomTimeFormat(currentProgram.start);
      const currentEnd = parseCustomTimeFormat(currentProgram.end);

      // 检查是否与已添加的节目重叠
      let hasOverlap = false;

      for (const existingProgram of cleanedPrograms) {
        const existingStart = parseCustomTimeFormat(existingProgram.start);
        const existingEnd = parseCustomTimeFormat(existingProgram.end);

        // 检查时间重叠（考虑完整的日期和时间）
        if (
          (currentStart >= existingStart && currentStart < existingEnd) || // 当前节目开始时间在已存在节目时间段内
          (currentEnd > existingStart && currentEnd <= existingEnd) || // 当前节目结束时间在已存在节目时间段内
          (currentStart <= existingStart && currentEnd >= existingEnd) // 当前节目完全包含已存在节目
        ) {
          hasOverlap = true;
          break;
        }
      }

      // 如果没有重叠，则添加该节目
      if (!hasOverlap) {
        cleanedPrograms.push(currentProgram);
      } else {
        // 如果有重叠，检查是否需要替换已存在的节目
        for (let j = 0; j < cleanedPrograms.length; j++) {
          const existingProgram = cleanedPrograms[j];
          const existingStart = parseCustomTimeFormat(existingProgram.start);
          const existingEnd = parseCustomTimeFormat(existingProgram.end);

          // 检查是否与当前节目重叠（考虑完整的日期和时间）
          if (
            (currentStart >= existingStart && currentStart < existingEnd) ||
            (currentEnd > existingStart && currentEnd <= existingEnd) ||
            (currentStart <= existingStart && currentEnd >= existingEnd)
          ) {
            // 计算节目时长
            const currentDuration = currentEnd.getTime() - currentStart.getTime();
            const existingDuration = existingEnd.getTime() - existingStart.getTime();

            // 如果当前节目时间更短，则替换已存在的节目
            if (currentDuration < existingDuration) {
              cleanedPrograms[j] = currentProgram;
            }
            break;
          }
        }
      }
    }

    return cleanedPrograms;
  };

  // 播放器引用
  const artPlayerRef = useRef<any>(null);

  // 分组标签滚动相关
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const channelListRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 获取直播源列表
  const fetchLiveSources = async () => {
    sourceRequest.current?.abort();
    const controller = new AbortController();
    sourceRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      setError(null);
      setLoadingStage('fetching');
      setLoadingMessage('正在获取直播源...');
      const response = await fetch('/api/live/sources', { signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '获取直播源失败');
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      const sources: LiveSource[] = result.data.filter((item: LiveSource) => !item.disabled);
      setLiveSources(sources);
      if (sources.length) {
        const source = sources.find(item => item.key === needLoadSource) || sources[0];
        currentSourceRef.current = source;
        setCurrentSource(source);
        await fetchChannels(source);
      }
      if (!controller.signal.aborted) { setLoadingStage('ready'); setLoading(false); }
    } catch {
      if (sourceRequest.current === controller) { setError('直播源加载失败，请检查网络后重试。'); setLoading(false); }
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('source'); params.delete('id');
        router.replace(params.toString() ? '?' + params : window.location.pathname);
      }
    }
  };

  const fetchChannels = async (source: LiveSource, refresh = false) => {
    attemptedAddresses.current.clear();
    setFailoverMessage('');
    const previousChannel = currentChannelRef.current;
    channelRequest.current?.abort();
    const controller = new AbortController();
    channelRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    setIsSwitchingSource(true);
    setChannelError('');
    setVideoUrl('');
    setCurrentChannel(null);
    setCurrentChannels([]);
    setGroupedChannels({});
    setFilteredChannels([]);
    setEpgData(null);
    try {
      const params = new URLSearchParams({ source: source.key });
      if (refresh) params.set('refresh', '1');
      const response = await fetch('/api/live/channels?' + params, { signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (channelRequest.current !== controller || controller.signal.aborted) return;
      if (!response.ok || !result.success) throw new Error(result.error || '获取频道列表失败');
      const channels: LiveChannel[] = result.data.map((item: LiveChannel) => ({ ...item, group: item.group || '其他' }));
      if (!channels.length) throw new Error('此直播源暂无频道，请刷新或切换直播源。');
      const grouped: Record<string, LiveChannel[]> = {};
      channels.forEach(channel => { if (!grouped[channel.group]) grouped[channel.group] = []; grouped[channel.group].push(channel); });
      const selected = channels.find(channel => previousChannel && ((previousChannel.tvgId && channel.tvgId === previousChannel.tvgId) || (channel.name === previousChannel.name && channel.group === previousChannel.group))) || channels.find(channel => channel.id === needLoadChannel) || channels[0];
      setCurrentChannels(channels);
      setGroupedChannels(grouped);
      setSelectedGroup(selected.group);
      setFilteredChannels(grouped[selected.group]);
      setCurrentChannel(selected);
      setVideoUrl(selected.url);
      setLiveSources(items => items.map(item => item.key === source.key ? { ...item, channelNumber: channels.length } : item));
      setActiveTab('channels');
    } catch (cause) {
      if (channelRequest.current === controller) setChannelError(controller.signal.aborted ? '频道加载超时，请刷新重试或切换直播源。' : cause instanceof Error ? cause.message : '频道加载失败，请重试。');
    } finally {
      clearTimeout(timer);
      if (channelRequest.current === controller) setIsSwitchingSource(false);
    }
  };

  // 切换直播源
  const handleSourceChange = async (source: LiveSource) => {
    currentSourceRef.current = source;
    setCurrentSource(source);
    await fetchChannels(source);
  };

  const handleChannelChange = (channel: LiveChannel) => {
    if (isSwitchingSource) return;
    attemptedAddresses.current.clear();
    setFailoverMessage('');
    setSelectionAttempt(value => value + 1);
    setCurrentChannel(channel);
    setVideoUrl(channel.url);
    scrollToChannel(channel);
  };

  const handleUnavailable = () => {
    if (!currentChannel) return false;
    attemptedAddresses.current.add(currentChannel.url);
    const alternative = nextLiveAlternative(currentChannels, currentChannel, attemptedAddresses.current);
    if (!alternative) return false;
    setFailoverMessage('已自动切换到该频道的备用线路');
    setCurrentChannel(alternative);
    setVideoUrl(alternative.url);
    scrollToChannel(alternative);
    return true;
  };

  // 滚动到指定频道位置的函数
  const scrollToChannel = (channel: LiveChannel) => {
    if (!channelListRef.current) return;

    // 使用 data 属性来查找频道元素
    const targetElement = channelListRef.current.querySelector(`[data-channel-id="${channel.id}"]`) as HTMLButtonElement;

    if (targetElement) {
      // 计算滚动位置，使频道居中显示
      const container = channelListRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();

      // 计算目标滚动位置
      const scrollTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 2) + (elementRect.height / 2);

      // 平滑滚动到目标位置
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      });
    }
  };

  // 切换分组
  const handleGroupChange = (group: string) => {
    // 如果正在切换直播源，则禁用分组切换
    if (isSwitchingSource) return;

    setSelectedGroup(group);
    const filtered = currentChannels.filter(channel => channel.group === group);
    setFilteredChannels(filtered);

    // 如果当前选中的频道在新的分组中，自动滚动到该频道位置
    if (currentChannel && filtered.some(channel => channel.id === currentChannel.id)) {
      setTimeout(() => {
        scrollToChannel(currentChannel);
      }, 100);
    } else {
      // 否则滚动到频道列表顶端
      if (channelListRef.current) {
        channelListRef.current.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    }
  };

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (!currentSourceRef.current || !currentChannelRef.current) return;

    try {
      const currentFavorited = favoritedRef.current;
      const newFavorited = !currentFavorited;

      // 立即更新状态
      setFavorited(newFavorited);
      favoritedRef.current = newFavorited;

      // 异步执行收藏操作
      try {
        if (newFavorited) {
          // 如果未收藏，添加收藏
          await saveFavorite(`live_${currentSourceRef.current.key}`, `live_${currentChannelRef.current.id}`, {
            title: currentChannelRef.current.name,
            source_name: currentSourceRef.current.name,
            year: '',
            cover: `/api/proxy/logo?url=${encodeURIComponent(currentChannelRef.current.logo)}&moontv-source=${currentSourceRef.current.key}`,
            total_episodes: 1,
            save_time: Date.now(),
            search_title: '',
            origin: 'live',
          });
        } else {
          // 如果已收藏，删除收藏
          await deleteFavorite(`live_${currentSourceRef.current.key}`, `live_${currentChannelRef.current.id}`);
        }
      } catch (err) {
        console.error('收藏操作失败:', err);
        // 如果操作失败，回滚状态
        setFavorited(currentFavorited);
        favoritedRef.current = currentFavorited;
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // 初始化
  useEffect(() => {
    void fetchLiveSources();
    return () => { sourceRequest.current?.abort(); channelRequest.current?.abort(); };
  }, []);

  // 检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentChannel) return;
    (async () => {
      try {
        const fav = await checkIsFavorited(`live_${currentSource.key}`, `live_${currentChannel.id}`);
        setFavorited(fav);
        favoritedRef.current = fav;
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentChannel]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentChannel) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(`live_${currentSource.key}`, `live_${currentChannel.id}`);
        const isFav = !!favorites[key];
        setFavorited(isFav);
        favoritedRef.current = isFav;
      }
    );

    return unsubscribe;
  }, [currentSource, currentChannel]);

  // 当分组切换时，将激活的分组标签滚动到视口中间
  useEffect(() => {
    if (!selectedGroup || !groupContainerRef.current) return;

    const groupKeys = Object.keys(groupedChannels);
    const groupIndex = groupKeys.indexOf(selectedGroup);
    if (groupIndex === -1) return;

    const btn = groupButtonRefs.current[groupIndex];
    const container = groupContainerRef.current;
    if (btn && container) {
      // 手动计算滚动位置，只滚动分组标签容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 计算按钮相对于容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 计算目标滚动位置，使按钮居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [selectedGroup, groupedChannels]);

  // Optional programme data loads independently and cannot overwrite a newer channel.
  useEffect(() => {
    setEpgData(null);
    if (!currentChannel?.tvgId || !currentSource) { setIsEpgLoading(false); return; }
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 20000);
    setIsEpgLoading(true);
    const query = new URLSearchParams({ source: currentSource.key, tvgId: currentChannel.tvgId });
    void fetch('/api/live/epg?' + query, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (active && result.success) setEpgData({ ...result.data, programs: cleanEpgData(result.data.programs) });
    }).catch(() => undefined).finally(() => { clearTimeout(timer); if (active) setIsEpgLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [currentSource?.key, currentChannel?.id]);

  // 全局快捷键处理
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 忽略输入框中的按键事件
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

      // 上箭头 = 音量+
      if (e.key === 'ArrowUp') {
        if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 下箭头 = 音量-
      if (e.key === 'ArrowDown') {
        if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 空格 = 播放/暂停
      if (e.key === ' ') {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
          e.preventDefault();
        }
      }

      // f 键 = 切换全屏
      if (e.key === 'f' || e.key === 'F') {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画直播图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>📺</div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'loading' ? 'bg-green-500 scale-125' : 'bg-green-500'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'fetching' ? 'bg-green-500 scale-125' : 'bg-green-500'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'ready' ? 'bg-green-500 scale-125' : 'bg-gray-300'
                    }`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'loading' ? '33%' : loadingStage === 'fetching' ? '66%' : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            {channelError && <div role='alert' className='mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'><span>{channelError}</span><button type='button' onClick={() => currentSource && void fetchChannels(currentSource, true)} className='rounded-lg bg-red-500 px-4 py-2 font-semibold text-white'>刷新频道</button></div>}
        <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-cyan-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：页面标题 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 max-w-[80%]'>
            <Radio className='w-5 h-5 text-blue-500 flex-shrink-0' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {currentSource?.name}
                {currentSource && currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentChannel.name}`}
                  </span>
                )}
                {currentSource && !currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentSource.name}`}
                  </span>
                )}
              </div>
            </div>
          </h1>
        </div>

        {/* 第二行：播放器和频道列表 */}
        <div className='space-y-2'>
          {failoverMessage && <p role='status' className='text-sm text-gray-600 dark:text-gray-300'>{failoverMessage}</p>}
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsChannelListCollapsed(!isChannelListCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isChannelListCollapsed ? '显示频道列表' : '隐藏频道列表'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isChannelListCollapsed ? 'rotate-180' : 'rotate-0'
                  }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isChannelListCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isChannelListCollapsed
                  ? 'bg-orange-400 animate-pulse'
                  : 'bg-green-400'
                  }`}
              ></div>
            </button>
          </div>

          <div className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isChannelListCollapsed
            ? 'grid-cols-1'
            : 'grid-cols-1 md:grid-cols-4'
            }`}>
            {/* 播放器 */}
            <div className={`h-full transition-all duration-300 ease-in-out ${isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'}`}>
              <div className='relative w-full h-[300px] lg:h-full'>
                {videoUrl && currentSource && currentChannel ? (
                  <LivePlayer key={currentSource.key + ':' + currentChannel.id + ':' + selectionAttempt} url={videoUrl} source={currentSource.key} poster={currentChannel.logo ? '/api/proxy/logo?' + new URLSearchParams({ url: currentChannel.logo, 'moontv-source': currentSource.key }) : undefined} playerRef={artPlayerRef} onRefresh={() => void fetchChannels(currentSource, true)} onUnavailable={handleUnavailable} />
                ) : <div className='flex h-full items-center justify-center rounded-xl bg-black/90 px-5 text-center text-sm text-white' role='status'>{isSwitchingSource ? '正在加载频道…' : '请选择直播源和频道'}</div>}

              </div>
            </div>

            {/* 频道列表 */}
            <div className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isChannelListCollapsed
              ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
              : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}>
              <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
                {/* 主要的 Tab 切换 */}
                <div className='flex mb-1 -mx-6 flex-shrink-0'>
                  <div
                    onClick={() => setActiveTab('channels')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${activeTab === 'channels'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    频道
                  </div>
                  <div
                    onClick={() => setActiveTab('sources')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${activeTab === 'sources'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    直播源
                  </div>
                </div>

                {/* 频道 Tab 内容 */}
                {activeTab === 'channels' && (
                  <>
                    {/* 分组标签 */}
                    <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
                      {/* 切换状态提示 */}
                      {isSwitchingSource && (
                        <div className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400'>
                          <div className='w-2 h-2 bg-amber-500 rounded-full animate-pulse'></div>
                          切换直播源中...
                        </div>
                      )}

                      <div
                        className='flex-1 overflow-x-auto'
                        ref={groupContainerRef}
                        onMouseEnter={() => {
                          // 鼠标进入分组标签区域时，添加滚轮事件监听
                          const container = groupContainerRef.current;
                          if (container) {
                            const handleWheel = (e: WheelEvent) => {
                              if (container.scrollWidth > container.clientWidth) {
                                e.preventDefault();
                                container.scrollLeft += e.deltaY;
                              }
                            };
                            container.addEventListener('wheel', handleWheel, { passive: false });
                            // 将事件处理器存储在容器上，以便后续移除
                            (container as any)._wheelHandler = handleWheel;
                          }
                        }}
                        onMouseLeave={() => {
                          // 鼠标离开分组标签区域时，移除滚轮事件监听
                          const container = groupContainerRef.current;
                          if (container && (container as any)._wheelHandler) {
                            container.removeEventListener('wheel', (container as any)._wheelHandler);
                            delete (container as any)._wheelHandler;
                          }
                        }}
                      >
                        <div className='flex gap-4 min-w-max'>
                          {Object.keys(groupedChannels).map((group, index) => (
                            <button
                              key={group}
                              data-group={group}
                              ref={(el) => {
                                groupButtonRefs.current[index] = el;
                              }}
                              onClick={() => handleGroupChange(group)}
                              disabled={isSwitchingSource}
                              className={`w-20 relative py-2 text-sm font-medium transition-colors flex-shrink-0 text-center overflow-hidden
                                 ${isSwitchingSource
                                  ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                                  : selectedGroup === group
                                    ? 'text-green-500 dark:text-green-400'
                                    : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                                }
                               `.trim()}
                            >
                              <div className='px-1 overflow-hidden whitespace-nowrap' title={group}>
                                {group}
                              </div>
                              {selectedGroup === group && !isSwitchingSource && (
                                <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 频道列表 */}
                    <div ref={channelListRef} className='flex-1 overflow-y-auto space-y-2 pb-4'>
                      {filteredChannels.length > 0 ? (
                        filteredChannels.map(channel => {
                          const isActive = channel.id === currentChannel?.id;
                          return (
                            <button
                              key={channel.id}
                              data-channel-id={channel.id}
                              onClick={() => handleChannelChange(channel)}
                              disabled={isSwitchingSource}
                              className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${isSwitchingSource
                                ? 'opacity-50 cursor-not-allowed'
                                : isActive
                                  ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            >
                              <div className='flex items-center gap-3'>
                                <div className='w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                                  {channel.logo ? (
                                    <img
                                      src={`/api/proxy/logo?url=${encodeURIComponent(channel.logo)}&moontv-source=${currentSource?.key || ''}`}
                                      alt={channel.name}
                                      className='w-full h-full rounded object-contain'
                                      loading="lazy"
                                    />
                                  ) : (
                                    <Tv className='w-5 h-5 text-gray-500' />
                                  )}
                                </div>
                                <div className='flex-1 min-w-0'>
                                  <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate' title={channel.name}>
                                    {channel.name}
                                  </div>
                                  <div className='text-xs text-gray-500 dark:text-gray-400 mt-1' title={channel.group}>
                                    {channel.group}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Tv className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            暂无可用频道
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            请选择其他直播源或稍后再试
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 直播源 Tab 内容 */}
                {activeTab === 'sources' && (
                  <div className='flex flex-col h-full mt-4'>
                    <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                      {liveSources.length > 0 ? (
                        liveSources.map((source) => {
                          const isCurrentSource = source.key === currentSource?.key;
                          return (
                            <div
                              key={source.key}
                              onClick={() => !isCurrentSource && handleSourceChange(source)}
                              className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                                ${isCurrentSource
                                  ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                                  : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                                }`.trim()}
                            >
                              {/* 图标 */}
                              <div className='w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center flex-shrink-0'>
                                <Radio className='w-6 h-6 text-gray-500' />
                              </div>

                              {/* 信息 */}
                              <div className='flex-1 min-w-0'>
                                <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                                  {source.name}
                                </div>
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                  {!source.channelNumber || source.channelNumber === 0 ? '-' : `${source.channelNumber} 个频道`}
                                </div>
                              </div>

                              {/* 当前标识 */}
                              {isCurrentSource && (
                                <div className='absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full'></div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Radio className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            暂无可用直播源
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            请检查网络连接或联系管理员添加直播源
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 当前频道信息 */}
        {currentChannel && (
          <div className='pt-4'>
            <div className='flex flex-col lg:flex-row gap-4'>
              {/* 频道图标+名称 - 在小屏幕上占100%，大屏幕占20% */}
              <div className='w-full flex-shrink-0'>
                <div className='flex items-center gap-4'>
                  <div className='w-20 h-20 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                    {currentChannel.logo ? (
                      <img
                        src={`/api/proxy/logo?url=${encodeURIComponent(currentChannel.logo)}&moontv-source=${currentSource?.key || ''}`}
                        alt={currentChannel.name}
                        className='w-full h-full rounded object-contain'
                        loading="lazy"
                      />
                    ) : (
                      <Tv className='w-10 h-10 text-gray-500' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 truncate'>
                        {currentChannel.name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite();
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title={favorited ? '取消收藏' : '收藏'}
                      >
                        <FavoriteIcon filled={favorited} />
                      </button>
                    </div>
                    <p className='text-sm text-gray-500 dark:text-gray-400 truncate'>
                      {currentSource?.name} {' > '} {currentChannel.group}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* EPG节目单 */}
            <EpgScrollableRow
              programs={epgData?.programs || []}
              currentTime={new Date()}
              isLoading={isEpgLoading}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-6 w-6'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-6 w-6 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function LivePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageGuard />
    </Suspense>
  );
}

function LivePageGuard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    setEnabled(!!runtimeConfig?.ENABLE_WEB_LIVE);
  }, []);

  if (enabled === null) {
    return <div>Loading...</div>;
  }

  if (!enabled) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex flex-col items-center justify-center min-h-[60vh] text-center px-4'>
          <Radio className='h-16 w-16 text-gray-300 dark:text-gray-600 mb-4' />
          <h2 className='text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2'>
            网页直播未开启
          </h2>
          <p className='text-gray-500 dark:text-gray-400 max-w-md'>
            当前站点未启用网页直播功能，请联系站点管理员开启。
          </p>
        </div>
      </PageLayout>
    );
  }

  return <LivePageClient />;
}
