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
              ['crayon', 'Crayon Player'],
              ['juliang', '巨量播放器'],
            ] as [VodPlayer, string][]
          ).map(([player, label]) => (
            <button
              key={player}
              type='button'
              aria-pressed={value.player === player}
              disabled={fullPlayerSource && player === 'crayon'}
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
          </>
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
            巨量自行管理进度、广告规则与连播，进度不会同步到本站。开启智能匹配后，巨量可能切换到其他线路或集数。
          </p>
        </details>
      ) : (
        <div className='space-y-1 text-xs leading-6 text-gray-500 dark:text-gray-400'>
          <p>
            使用独立 Crayon
            Player。首次使用请在播放器内输入访问密码；如登录受浏览器限制，可点击「独立打开」。
          </p>
          <p>
            进度、片头片尾、去广告和投屏由播放器自行管理，进度不会同步到本站；请使用本站选集面板切换集数。
          </p>
        </div>
      )}
    </div>
  );
}

export function EmbeddedVodPlayer({
  player,
  url,
  title,
}: {
  player: VodPlayer;
  url: string | null;
  title: string;
}) {
  const name = player === 'crayon' ? 'Crayon Player' : '巨量播放器';
  // The parent keys by URL, releasing the old iframe and its media on each switch.
  const [status, setStatus] = useState<'connecting' | 'loaded' | 'slow'>(
    'connecting'
  );
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
          title={`${name} · ${title}`}
          allow='autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock'
          allowFullScreen
          referrerPolicy='no-referrer'
          className='min-h-0 w-full flex-1 border-0'
          onLoad={() => setStatus('loaded')}
        />
      ) : (
        <p role='alert' className='m-auto px-6 text-sm text-white'>
          当前地址无法交给{name}播放，请选择其他播放源。
        </p>
      )}
      {url && (
        <p
          role='status'
          className='shrink-0 px-3 py-1.5 text-center text-xs leading-5 text-gray-300'
        >
          {status === 'connecting'
            ? `正在连接${name}…`
            : status === 'loaded'
            ? player === 'crayon'
              ? '若显示登录页，请输入访问密码；未出画面时可点击播放器内的播放按钮或独立打开。'
              : '未出画面时，请点击播放器内的播放按钮，或切换备用入口。'
            : player === 'crayon'
            ? '播放器连接较慢或不可用，请独立打开、刷新页面或切换巨量播放器。'
            : '入口连接较慢或不可用，请切换备用入口、独立打开或使用 Crayon Player。'}
        </p>
      )}
    </div>
  );
}
