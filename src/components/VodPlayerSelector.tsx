'use client';

import { ExternalLink, MonitorPlay, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  JULIANG_ENTRIES,
  JuliangEntry,
  VodPlayer,
  VodPlayerPreferences,
} from '@/lib/vod-player';

export function VodPlayerSelector({
  value,
  onChange,
  externalUrl,
  fullPlayerSource,
}: {
  value: VodPlayerPreferences;
  onChange: (value: VodPlayerPreferences) => void;
  externalUrl: string | null;
  fullPlayerSource: boolean;
}) {
  return (
    <div className='space-y-3 rounded-2xl border border-gray-200/70 bg-white/75 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/70'>
      <div className='flex flex-wrap items-center gap-3'>
        <span className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
          <MonitorPlay size={17} aria-hidden='true' /> 播放器
        </span>
        <div
          role='group'
          aria-label='选择播放器'
          className='flex rounded-xl bg-gray-100 p-1 dark:bg-gray-800'
        >
          {(
            [
              ['artplayer', '内置播放器'],
              ['juliang', '巨量播放器'],
            ] as [VodPlayer, string][]
          ).map(([player, label]) => (
            <button
              key={player}
              type='button'
              aria-pressed={value.player === player}
              disabled={fullPlayerSource && player === 'artplayer'}
              onClick={() => onChange({ ...value, player })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                value.player === player
                  ? 'bg-white text-green-700 shadow-sm dark:bg-gray-700 dark:text-green-300'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {value.player === 'juliang' && (
          <>
            <label className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300'>
              入口
              <select
                aria-label='巨量播放器入口'
                value={value.entry}
                onChange={(event) =>
                  onChange({
                    ...value,
                    entry: event.target.value as JuliangEntry,
                  })
                }
                className='min-w-[8rem] rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 dark:border-gray-600 dark:bg-gray-800'
              >
                {Object.entries(JULIANG_ENTRIES).map(([key, { name }]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {!fullPlayerSource && (
              <label className='flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300'>
                <input
                  type='checkbox'
                  checked={value.smartMatch}
                  onChange={(event) =>
                    onChange({ ...value, smartMatch: event.target.checked })
                  }
                  className='accent-green-600'
                />
                智能匹配线路
              </label>
            )}
            {externalUrl && (
              <a
                href={externalUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-green-700 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950'
              >
                <ExternalLink size={15} aria-hidden='true' /> 独立打开
              </a>
            )}
          </>
        )}
      </div>
      {value.player === 'juliang' ? (
        <details className='text-xs leading-6 text-gray-500 dark:text-gray-400'>
          <summary className='cursor-pointer text-gray-600 dark:text-gray-300'>
            广告屏蔽与使用说明
          </summary>
          <p className='mt-1 flex gap-2'>
            <ShieldCheck
              size={16}
              className='mt-1 shrink-0'
              aria-hidden='true'
            />
            在巨量播放器设置中开启「广告屏蔽」，可选智能屏蔽、手动圈选、撤销误遮。识别效果取决于片源与浏览器，无法保证过滤全部广告。
          </p>
          <p>
            iPhone
            系统视频全屏不显示画面遮挡，可用「独立打开」保留网页播放器的遮挡功能。
          </p>
          <p>
            巨量自行管理进度、广告规则与连播，进度不会同步到本站；本站片头片尾配置仅用于内置播放器。开启智能匹配后，巨量可能切换到其他线路或集数。
          </p>
        </details>
      ) : (
        <p className='text-xs text-gray-500 dark:text-gray-400'>
          支持本站观看进度、自动连播与片头片尾设置；播放器选择会在此浏览器记住。
        </p>
      )}
    </div>
  );
}

export function JuliangPlayer({
  url,
  title,
}: {
  url: string | null;
  title: string;
}) {
  // The parent keys by URL, releasing the old iframe and its media on each switch.
  const [status, setStatus] = useState<
    'connecting' | 'loaded' | 'slow' | 'error'
  >('connecting');
  useEffect(() => {
    const timer = setTimeout(
      () => setStatus((value) => (value === 'connecting' ? 'slow' : value)),
      12000
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className='flex h-full w-full flex-col overflow-hidden rounded-xl bg-black shadow-lg'>
      {url ? (
        <iframe
          src={url}
          title={`巨量播放器 · ${title}`}
          allow='autoplay; fullscreen; picture-in-picture'
          allowFullScreen
          className='min-h-0 w-full flex-1 border-0'
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      ) : (
        <p role='alert' className='m-auto px-6 text-sm text-white'>
          当前地址无法交给巨量播放，请选择其他播放源。
        </p>
      )}
      {url && (
        <p
          role='status'
          className='shrink-0 px-3 py-1.5 text-center text-xs leading-5 text-gray-300'
        >
          {status === 'connecting'
            ? '正在连接巨量播放器…'
            : status === 'loaded'
            ? '未出画面时，请点击播放器内的播放按钮，或切换备用入口。'
            : '入口连接较慢或不可用，请切换备用入口、独立打开或使用内置播放器。'}
        </p>
      )}
    </div>
  );
}
