'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { MutableRefObject, useEffect, useRef, useState } from 'react';

import {
  liveBufferAhead,
  liveHlsConfig,
  liveStartupBuffer,
} from '@/lib/live-playback';
import { livePlaylistLoader } from '@/lib/live-playlist-loader';

interface Props {
  url: string;
  source: string;
  poster?: string;
  playerRef: MutableRefObject<Artplayer | null>;
  onRefresh?: () => void;
  onUnavailable?: () => boolean;
}

export default function LivePlayer({
  url,
  source,
  poster,
  playerRef,
  onRefresh,
  onUnavailable,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsPlay, setNeedsPlay] = useState(false);
  const [forceProxy, setForceProxy] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const timelineRestart = useRef({ url, source, at: 0 });

  useEffect(() => {
    if (!container.current || !url || !source) return;
    let disposed = false;
    let failed = false;
    let hls: Hls | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let bufferingTimer: ReturnType<typeof setTimeout> | undefined;
    let art: Artplayer | undefined;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let lastProgress = Date.now();
    let lastTime = -1;
    let autoplayTried = false;
    let stableSince = 0;
    let startupSince = 0;
    let started = false;
    let waitingSince = 0;
    let stalls: number[] = [];
    const controller = new AbortController();
    const previousReconnectLimit = Artplayer.RECONNECT_TIME_MAX;
    if (
      timelineRestart.current.url !== url ||
      timelineRestart.current.source !== source
    )
      timelineRestart.current = { url, source, at: 0 };
    setLoading(true);
    setError('');
    setNeedsPlay(false);
    setHasStarted(false);

    const clearBuffering = () => {
      clearTimeout(bufferingTimer);
      bufferingTimer = undefined;
      setLoading(false);
    };

    const fail = (message: string, tryAlternative = true) => {
      if (disposed || failed) return;
      failed = true;
      clearTimeout(retryTimer);
      clearTimeout(startupTimer);
      clearTimeout(bufferingTimer);
      setLoading(false);
      setError(message);
      hls?.stopLoad();
      if (!hls && art) {
        art.video.pause();
        art.video.removeAttribute('src');
        art.video.load();
      }
      if (tryAlternative) unavailable.current?.();
    };
    const restartTimeline = () => {
      if (disposed || failed) return false;
      const now = Date.now();
      if (
        timelineRestart.current.at &&
        now - timelineRestart.current.at < 90000
      )
        return false;
      timelineRestart.current.at = now;
      failed = true;
      hls?.stopLoad();
      setAttempt((value) => value + 1);
      return true;
    };
    const play = () => {
      if (disposed || failed || !art || autoplayTried) return;
      const required = liveStartupBuffer(hls?.latestLevelDetails);
      if (required && liveBufferAhead(art.video) + 0.1 < required) {
        if (!startupSince) startupSince = Date.now();
        // Some native engines or very short sources won't fill while paused.
        // Keep the wait finite and let normal playback/recovery take over.
        if (Date.now() - startupSince < 6000) {
          if (!startupTimer)
            startupTimer = setTimeout(() => {
              startupTimer = undefined;
              play();
            }, 200);
          return;
        }
      }
      clearTimeout(startupTimer);
      autoplayTried = true;
      art.video.play().catch(() => {
        if (!disposed) {
          setNeedsPlay(true);
          setLoading(false);
        }
      });
    };
    const recover = () => {
      if (disposed || failed) return;
      lastProgress = Date.now();
      if (hls) hls.startLoad(-1);
      else if (art) {
        art.video.load();
        autoplayTried = false;
      }
    };
    const initialize = async () => {
      // A failed or slow probe must not prevent the player itself trying HLS.
      let type = /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : 'm3u8';
      if (/\.flv(?:[?#]|$)/i.test(url)) type = 'flv';
      if (!/\.m3u8(?:[?#]|$)/i.test(url) && type === 'm3u8') {
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          const query = new URLSearchParams({ url, 'moontv-source': source });
          const response = await fetch(`/api/live/precheck?${query}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (response.ok) type = (await response.json()).type || type;
        } catch {
          /* The actual player reports an actionable error if this also fails. */
        } finally {
          clearTimeout(timeout);
        }
      }
      if (disposed || !container.current) return;
      if (type === 'flv' || !/^https?:\/\//i.test(url)) {
        fail('此频道的直播格式无法在当前网页播放，请切换到 HLS / M3U8 频道。');
        return;
      }
      const query = new URLSearchParams({ url, 'moontv-source': source });
      let direct = false;
      try {
        direct =
          localStorage.getItem('liveDirectConnect') === 'true' && !forceProxy;
      } catch {
        /* Storage can be unavailable in private mode. */
      }
      if (direct) query.set('allowCORS', 'true');
      const target = `/api/proxy/${
        type === 'mp4' ? 'segment' : 'm3u8'
      }?${query}`;
      try {
        Artplayer.USE_RAF = false;
        Artplayer.FULLSCREEN_WEB_IN_BODY = true;
        // Recovery is owned by this component; avoid Artplayer starting a second retry loop.
        Artplayer.RECONNECT_TIME_MAX = 0;
        art = new Artplayer({
          container: container.current,
          url: target,
          type,
          poster: poster || '',
          isLive: true,
          autoplay: false,
          muted: false,
          volume: 0.7,
          playsInline: true,
          fullscreen: true,
          fullscreenWeb: true,
          pip: true,
          airplay: true,
          autoSize: false,
          autoMini: false,
          autoPlayback: false,
          hotkey: false,
          theme: '#ef4444',
          lang: 'zh-cn',
          moreVideoAttr: { preload: 'auto', crossOrigin: 'anonymous' },
          customType: {
            m3u8(video: HTMLVideoElement, playlist: string) {
              if (disposed) return;
              // Safari/iOS native HLS also follows the fully rewritten proxy URLs.
              if (
                !Hls.isSupported() &&
                video.canPlayType('application/vnd.apple.mpegurl')
              ) {
                video.src = playlist;
              } else if (Hls.isSupported()) {
                hls = new Hls({
                  ...liveHlsConfig(),
                  pLoader: livePlaylistLoader(Hls.DefaultConfig.loader, () => {
                    if (!restartTimeline())
                      fail('直播源的播放列表反复异常，请重试或切换频道。');
                  }),
                });
                hls.on(Hls.Events.ERROR, (_event, data) => {
                  if (disposed || failed || !data.fatal) return;
                  if (data.response?.code === 401) {
                    fail('登录已失效，请重新登录后播放直播。', false);
                    return;
                  }
                  if (data.type === Hls.ErrorTypes.NETWORK_ERROR && direct) {
                    // A saved direct setting must not strand every channel on a
                    // CORS failure. Retry once with all resources proxied.
                    setForceProxy(true);
                    return;
                  }
                  if (
                    data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                    data.context?.url
                  ) {
                    const resolved = new URL(
                      data.context.url,
                      window.location.href
                    ).searchParams.get('url');
                    // A relocated backend may use an expiring signature.
                    // Reopen the original entry once, rather than retrying
                    // the expired resolved URL indefinitely.
                    if (resolved && resolved !== url && restartTimeline())
                      return;
                  }
                  if (
                    data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                    networkRecoveries < 2
                  ) {
                    networkRecoveries++;
                    setLoading(true);
                    clearTimeout(retryTimer);
                    retryTimer = setTimeout(recover, networkRecoveries * 1500);
                  } else if (
                    data.type === Hls.ErrorTypes.MEDIA_ERROR &&
                    mediaRecoveries < 1
                  ) {
                    mediaRecoveries++;
                    hls?.recoverMediaError();
                  } else {
                    let message =
                      '频道暂时无法播放，可能是直播源失效或网络不稳定。请重试或切换频道。';
                    try {
                      const text = data.networkDetails?.responseText;
                      const detail =
                        typeof text === 'string' ? JSON.parse(text).error : '';
                      if (
                        typeof detail === 'string' &&
                        detail.startsWith('直播') &&
                        detail.length < 160
                      )
                        message = detail;
                    } catch {
                      /* An upstream HTML error is not a user-facing message. */
                    }
                    fail(message);
                  }
                });
                hls.loadSource(playlist);
                hls.attachMedia(video);
              } else
                fail(
                  '当前浏览器不支持 HLS 直播，请使用新版 Safari、Chrome 或 Edge。'
                );
            },
          },
        });
        playerRef.current = art;
        art.on('video:canplay', () => {
          if (!disposed) {
            play();
          }
        });
        art.on('video:playing', () => {
          if (!disposed && !failed) {
            const now = Date.now();
            if (waitingSince && now - waitingSince >= 1500) {
              stalls = stalls.filter((time) => now - time < 90000);
              stalls.push(now);
              if (stalls.length >= 3) {
                stalls = [];
                if (unavailable.current?.()) {
                  failed = true;
                  hls?.stopLoad();
                  return;
                }
              }
            }
            waitingSince = 0;
            lastProgress = Date.now();
            started = true;
            setHasStarted(true);
            clearBuffering();
            setNeedsPlay(false);
            setError('');
          }
        });
        art.on('video:timeupdate', () => {
          if (disposed || failed || !art || art.video.currentTime === lastTime)
            return;
          lastTime = art.video.currentTime;
          lastProgress = Date.now();
          clearBuffering();
          if (!stableSince) stableSince = lastProgress;
          if (lastProgress - stableSince > 30000) {
            networkRecoveries = 0;
            mediaRecoveries = 0;
            stableSince = lastProgress;
          }
        });
        art.on('video:waiting', () => {
          if (!disposed && !failed) {
            stableSince = 0;
            if (started && !art?.video.paused && !waitingSince)
              waitingSince = Date.now();
            if (!started) setLoading(true);
            else if (!bufferingTimer)
              bufferingTimer = setTimeout(() => {
                bufferingTimer = undefined;
                if (
                  !disposed &&
                  !failed &&
                  art &&
                  !art.video.paused &&
                  art.video.readyState < 3
                )
                  setLoading(true);
              }, 700);
          }
        });
        art.on('video:pause', () => {
          waitingSince = 0;
          if (!disposed && !failed && started) clearBuffering();
        });
        art.on('video:error', () => {
          if (hls || disposed || failed) return;
          if (art?.video.error?.code === 2 && direct) {
            setForceProxy(true);
            return;
          }
          if (art?.video.error?.code === 2 && networkRecoveries < 2) {
            networkRecoveries++;
            setLoading(true);
            clearTimeout(retryTimer);
            retryTimer = setTimeout(recover, networkRecoveries * 1500);
          } else
            fail('频道无法播放或浏览器不支持该频道的编码，请重试或切换频道。');
        });
      } catch {
        fail('播放器加载失败，请重试。');
      }
    };
    void initialize();
    const watchdog = setInterval(() => {
      if (
        disposed ||
        failed ||
        document.hidden ||
        !art ||
        (art.video.paused && art.video.readyState >= 2)
      )
        return;
      if (Date.now() - lastProgress > 30000)
        fail('频道连接超时或长时间没有画面，请重试或切换频道。');
    }, 3000);
    const online = () => {
      if (!disposed) {
        failed = false;
        networkRecoveries = 0;
        mediaRecoveries = 0;
        setError('');
        setLoading(true);
        recover();
      }
    };
    const visible = () => {
      if (
        !document.hidden &&
        art &&
        !art.video.paused &&
        Date.now() - lastProgress > 15000
      )
        recover();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(retryTimer);
      clearTimeout(startupTimer);
      clearTimeout(bufferingTimer);
      clearInterval(watchdog);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      hls?.destroy();
      if (Artplayer.RECONNECT_TIME_MAX === 0)
        Artplayer.RECONNECT_TIME_MAX = previousReconnectLimit;
      if (art) {
        const video = art.video;
        art.destroy(false);
        video.removeAttribute('src');
        video.load();
        if (playerRef.current === art) playerRef.current = null;
      }
    };
  }, [url, source, poster, attempt, forceProxy, playerRef]);

  return (
    <div
      className='relative isolate h-full w-full scroll-mt-24 overflow-hidden rounded-xl bg-black'
      data-live-player
    >
      <div ref={container} className='relative z-0 h-full w-full' />
      {loading && !error && !needsPlay && (
        <div
          className={`pointer-events-none absolute z-10 flex items-center justify-center text-sm text-white ${
            hasStarted
              ? 'bottom-16 left-4 rounded-lg bg-black/60 px-3 py-2'
              : 'inset-0 bg-black/60'
          }`}
          role='status'
        >
          {hasStarted ? '正在缓冲…' : '正在连接直播…'}
        </div>
      )}
      {needsPlay && !error && (
        <button
          type='button'
          onClick={() => {
            playerRef.current?.video
              .play()
              .then(() => setNeedsPlay(false))
              .catch(() => setError('播放未成功，请重试或切换频道。'));
          }}
          className='absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-lg font-semibold text-white'
        >
          点击播放直播
        </button>
      )}
      {error && (
        <div
          className='absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 px-5 text-center text-sm text-white'
          role='alert'
        >
          <p className='max-w-md leading-6'>{error}</p>
          <div className='flex flex-wrap justify-center gap-3'>
            <button
              type='button'
              onClick={() => setAttempt((value) => value + 1)}
              className='rounded-lg bg-red-500 px-4 py-2 font-semibold'
            >
              重新连接
            </button>
            <button
              type='button'
              onClick={() => {
                setForceProxy(true);
                setAttempt((value) => value + 1);
              }}
              className='rounded-lg border border-white/40 px-4 py-2'
            >
              使用代理重试
            </button>
          </div>
          {onRefresh && (
            <button
              type='button'
              onClick={onRefresh}
              className='text-sm text-yellow-300 underline underline-offset-4'
            >
              刷新频道地址
            </button>
          )}
          <p className='text-xs text-gray-300'>
            也可以从频道列表选择其他频道或直播源
          </p>
        </div>
      )}
    </div>
  );
}
