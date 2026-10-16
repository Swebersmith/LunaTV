'use client';

import {
  ArrowDownUp,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Tv,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildShinchanCollection,
  findShinchanMovie,
  getShinchanMovie,
  isShinchanVideo,
  mergeShinchanMovies,
  normalizeShinchanTitle,
  SHINCHAN_MOVIES,
  ShinchanMovie,
  shinchanPlaybackUrl,
} from '@/lib/shinchan-catalog';
import { discoverShinchanVideos } from '@/lib/shinchan-client';
import type { ShinchanCatalogSnapshot } from '@/lib/shinchan-metadata';
import type { SearchResult } from '@/lib/types';
import { useShinchanAutoRefresh } from '@/hooks/useShinchanAutoRefresh';

import CapsuleSwitch from './CapsuleSwitch';
import { SquadColors, SquadIllustration } from './CrayonTheme';
import PageLayout from './PageLayout';

type View = 'all' | 'series' | 'movies';
interface Selection {
  key: string;
  title: string;
  results: SearchResult[];
  movie?: ShinchanMovie;
}

async function searchVideos(
  query: string,
  signal: AbortSignal
): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
    signal,
    cache: 'no-store',
  });
  if (response.status === 401)
    throw new Error('登录状态已失效，请重新登录后查看片源。');
  if (!response.ok) throw new Error('片源加载失败，请稍后重试。');
  const data = await response.json();
  if (!Array.isArray(data.results))
    throw new Error('片源返回格式异常，请稍后重试。');
  return (data.results as SearchResult[]).filter(isShinchanVideo);
}

function Poster({ url, year }: { url?: string; year?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className='shinchan-poster'>
      <div className='shinchan-poster-placeholder' aria-hidden='true'>
        <Film size={30} />
        <span>{year || 'SHINCHAN'}</span>
      </div>
      {url && /^https?:\/\//i.test(url) && !failed && (
        <Image
          src={url}
          alt=''
          fill
          sizes='(max-width: 640px) 45vw, 200px'
          className='object-cover'
          onError={() => setFailed(true)}
        />
      )}
      {year && <span className='shinchan-year'>{year}</span>}
    </div>
  );
}

export default function ShinchanCollection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view: View =
    searchParams.get('view') === 'movies'
      ? 'movies'
      : searchParams.get('view') === 'series'
      ? 'series'
      : 'all';
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const { revision, refresh } = useShinchanAutoRefresh();
  const [catalog, setCatalog] = useState(SHINCHAN_MOVIES);
  const [catalogStatus, setCatalogStatus] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [partialSources, setPartialSources] = useState(false);
  const [query, setQuery] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const collection = useMemo(
    () => buildShinchanCollection(records, catalog),
    [records, catalog]
  );
  const collectionRef = useRef(collection);
  collectionRef.current = collection;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const [metadata, discovered] = await Promise.allSettled([
          (async () => {
            const response = await fetch('/api/shinchan/catalog', {
              signal: controller.signal,
              cache: 'no-store',
            });
            if (!response.ok) throw new Error('目录同步暂不可用');
            const data = (await response.json()) as ShinchanCatalogSnapshot;
            if (!Array.isArray(data.movies)) throw new Error('目录格式异常');
            return data;
          })(),
          discoverShinchanVideos(controller.signal).then((data) => {
            if (!controller.signal.aborted) setRecords(data.results);
            return data;
          }),
        ]);
        if (controller.signal.aborted) return;
        const movies =
          metadata.status === 'fulfilled'
            ? mergeShinchanMovies(
                collectionRef.current.movieCatalog,
                metadata.value.movies
              )
            : collectionRef.current.movieCatalog;
        setCatalogStatus(
          metadata.status === 'fulfilled' && metadata.value.status === 'current'
            ? ''
            : '部分目录服务暂不可用，已保留已有清单，稍后自动重试。'
        );
        setCatalog(movies);
        if (discovered.status === 'rejected') throw discovered.reason;
        const results = discovered.value.results;
        setPartialSources(discovered.value.partial);
        const next = buildShinchanCollection(results, movies);
        setCatalog(next.movieCatalog);
        if (!controller.signal.aborted) {
          setRecords(results);
          setCheckedAt(new Date().toISOString());
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : '片源加载失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const element = dialog.current;
    if (selected && element && !element.open) element.showModal();
    else if (!selected && element?.open) element.close();
  }, [selected]);

  useEffect(() => {
    setResolveError('');
    setResolving(false);
    if (
      !selected?.movie ||
      collectionRef.current.movies.get(
        (
          findShinchanMovie(
            selected.movie.title,
            collectionRef.current.movieCatalog
          ) ?? selected.movie
        ).id
      )?.length
    )
      return;
    if (loading) {
      setResolving(true);
      return;
    }
    const movie = selected.movie;
    const controller = new AbortController();
    setResolving(true);
    (async () => {
      try {
        // Search only the selected missing film, rather than issuing 34 searches on entry.
        for (const term of Array.from(
          new Set([movie.title, movie.aliases[0]])
        )) {
          if (!term) continue;
          const found = (await searchVideos(term, controller.signal)).filter(
            (result) =>
              getShinchanMovie(result, collectionRef.current.movieCatalog)
                ?.id ===
              (
                findShinchanMovie(
                  movie.title,
                  collectionRef.current.movieCatalog
                ) ?? movie
              ).id
          );
          if (found.length && !controller.signal.aborted) {
            setRecords((previous) => [...previous, ...found]);
            break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setResolveError(
            error instanceof Error ? error.message : '查找失败，请稍后重试'
          );
      } finally {
        if (!controller.signal.aborted) setResolving(false);
      }
    })();
    return () => controller.abort();
  }, [selected, loading]);

  const term = normalizeShinchanTitle(query);
  const series = collection.series.filter(
    (group) =>
      !term ||
      normalizeShinchanTitle(group.title).includes(term) ||
      group.results.some((result) =>
        normalizeShinchanTitle(result.title).includes(term)
      )
  );
  const movies = collection.movieCatalog.filter(
    (movie) =>
      (!term ||
        [String(movie.year), movie.title, ...movie.aliases].some((title) =>
          normalizeShinchanTitle(title).includes(term)
        )) &&
      (!availableOnly || collection.movies.has(movie.id))
  );
  if (newestFirst) movies.reverse();
  const selectedResults = selected?.movie
    ? collection.movies.get(
        (
          findShinchanMovie(selected.movie.title, collection.movieCatalog) ??
          selected.movie
        ).id
      ) ?? []
    : collection.series.find((group) => group.key === selected?.key)?.results ??
      (selected?.key === 'movie-bundles'
        ? collection.bundles
        : selected?.results) ??
      [];
  const resultKeys = new Set<string>();
  const sources = selectedResults.filter((result) => {
    const key = `${result.source}\0${result.id}`;
    if (resultKeys.has(key)) return false;
    resultKeys.add(key);
    return true;
  });

  return (
    <PageLayout activePath='/shinchan'>
      <div className='shinchan-collection'>
        <section className='shinchan-intro'>
          <div>
            <span className='crayon-badge'>
              <SquadColors /> 春日部防卫队 · 专属放映清单
            </span>
            <h1>
              今天，就看<span>蜡笔小新。</span>
            </h1>
            <p>
              从电视动画各季，到一路陪我们长大的剧场版。
              <br />
              选一部，和小新一起把日常变成冒险。
            </p>
            <div className='shinchan-stats'>
              <span>
                <Tv size={15} />{' '}
                {loading
                  ? '正在整理各季'
                  : `${
                      collection.series.filter((g) => g.season !== null).length
                    } 季电视动画`}
              </span>
              <span>
                <Film size={15} /> {collection.movieCatalog.length} 部电影目录
              </span>
            </div>
          </div>
          <div className='shinchan-intro-art'>
            <SquadIllustration />
          </div>
        </section>

        <p className='shinchan-catalog-note' role='status'>
          {loading
            ? '正在自动整理最新目录与片源…'
            : `已开启自动整理${
                checkedAt
                  ? ` · 最近检查 ${new Date(checkedAt).toLocaleTimeString(
                      'zh-CN',
                      { hour: '2-digit', minute: '2-digit' }
                    )}`
                  : ''
              } · 新季、新电影及新增集数会自动跟进。`}
        </p>
        {(catalogStatus || partialSources) && (
          <p className='shinchan-notice'>
            {catalogStatus}
            {partialSources
              ? ' 部分片源暂不可用，已显示成功检索的版本，稍后自动重试。'
              : ''}
          </p>
        )}

        <div className='shinchan-toolbar'>
          <CapsuleSwitch
            options={[
              { label: '全部', value: 'all' },
              { label: '电视动画', value: 'series' },
              { label: '剧场版', value: 'movies' },
            ]}
            active={view}
            onChange={(value) =>
              router.replace(`${pathname}?view=${value}`, { scroll: false })
            }
          />
          <div className='shinchan-tools'>
            <label className='shinchan-filter'>
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='片名、季数或年份'
                aria-label='筛选小新专区'
              />
            </label>
            <button
              className='shinchan-refresh'
              onClick={refresh}
              disabled={loading}
              aria-label='刷新小新片源'
            >
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {loadError && (
          <div className='shinchan-notice' role='alert'>
            {loadError} <button onClick={refresh}>重新加载</button>
          </div>
        )}
        {!loadError && loading && (
          <p className='shinchan-loading' role='status'>
            <LoaderCircle size={17} className='animate-spin' />{' '}
            正在为各季和剧场版整理播放版本…
          </p>
        )}

        {view !== 'movies' && (
          <section
            className='shinchan-section'
            aria-labelledby='shinchan-series-title'
          >
            <div className='shinchan-section-heading'>
              <h2 id='shinchan-series-title'>
                <Tv size={21} /> 电视动画 · 全季
              </h2>
              <span>国语、日语及全集版本</span>
            </div>
            {loading && !series.length ? (
              <div className='shinchan-season-grid' aria-hidden='true'>
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className='shinchan-season-skeleton animate-pulse'
                  />
                ))}
              </div>
            ) : (
              <div className='shinchan-season-grid'>
                {series.map((group) => (
                  <button
                    key={group.key}
                    className='shinchan-season-card'
                    onClick={() =>
                      setSelected({
                        key: group.key,
                        title: `蜡笔小新 · ${group.title}`,
                        results: group.results,
                      })
                    }
                  >
                    <span className='shinchan-season-number'>
                      {group.season
                        ? String(group.season).padStart(2, '0')
                        : 'ALL'}
                    </span>
                    <div>
                      <h3>{group.title}</h3>
                      <p>
                        {Math.max(
                          ...group.results.map(
                            (result) => result.episodes.length
                          )
                        )}{' '}
                        集 · {group.results.length} 个版本
                      </p>
                    </div>
                    <Play size={19} />
                  </button>
                ))}
              </div>
            )}
            {!loading && !series.length && (
              <div className='crayon-empty'>
                暂未找到匹配的电视动画。
                <Link
                  href='/search?q=%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0'
                  className='crayon-secondary-link'
                >
                  搜索更多版本
                </Link>
              </div>
            )}
          </section>
        )}

        {view !== 'series' && (
          <section
            className='shinchan-section'
            aria-labelledby='shinchan-movies-title'
          >
            <div className='shinchan-section-heading'>
              <h2 id='shinchan-movies-title'>
                <Film size={21} /> 历年剧场版
              </h2>
              <div className='shinchan-movie-controls'>
                <label>
                  <input
                    type='checkbox'
                    checked={availableOnly}
                    onChange={(event) => setAvailableOnly(event.target.checked)}
                  />{' '}
                  只看已找到片源
                </label>
                <button onClick={() => setNewestFirst((value) => !value)}>
                  <ArrowDownUp size={14} />{' '}
                  {newestFirst ? '从新到旧' : '从早到晚'}
                </button>
              </div>
            </div>
            <p className='shinchan-catalog-note'>
              目录根据官方上映记录和动态条目资料自动整理，按日本首映年份排列，包含
              3DCG
              剧场版，天象电影等会标注“特别放映”。已发布和已找到播放源分别显示。
            </p>
            {collection.bundles.length > 0 && (
              <button
                className='shinchan-bundle'
                onClick={() =>
                  setSelected({
                    key: 'movie-bundles',
                    title: '蜡笔小新 · 剧场版合集',
                    results: collection.bundles,
                  })
                }
              >
                <Film size={19} />
                <span>
                  <strong>剧场版合集</strong> 也可以从合集的选集列表观看
                </span>
                <Play size={17} />
              </button>
            )}
            <div className='shinchan-movie-grid'>
              {movies.map((movie) => {
                const versions = collection.movies.get(movie.id) ?? [];
                return (
                  <button
                    className='shinchan-movie-card'
                    key={movie.id}
                    onClick={() =>
                      setSelected({
                        key: movie.id,
                        title: `蜡笔小新：${movie.title}`,
                        results: [],
                        movie,
                      })
                    }
                  >
                    <Poster
                      url={versions.find((result) => result.poster)?.poster}
                      year={movie.year}
                    />
                    <h3>{movie.title}</h3>
                    <p className={versions.length ? 'shinchan-found' : ''}>
                      {movie.edition === 'special-screening'
                        ? '特别放映 · '
                        : ''}
                      {versions.length
                        ? `${versions.length} 个版本 · 选择播放`
                        : loading
                        ? '正在匹配片源'
                        : movie.releaseDate &&
                          movie.releaseDate >
                            new Date()
                              .toISOString()
                              .slice(0, movie.releaseDate.length)
                        ? '尚未上映 · 自动跟进'
                        : movie.releaseDate
                        ? '已发布 · 等待片源'
                        : '等待片源 · 自动跟进'}
                    </p>
                  </button>
                );
              })}
            </div>
            {!movies.length && (
              <div className='crayon-empty'>没有符合筛选条件的剧场版。</div>
            )}
          </section>
        )}

        {view === 'all' && !term && collection.extras.length > 0 && (
          <section className='shinchan-section'>
            <div className='shinchan-section-heading'>
              <h2>外传与其他作品</h2>
            </div>
            <div className='shinchan-extra-list'>
              {collection.extras.map((result) => (
                <Link
                  key={`${result.source}-${result.id}`}
                  href={shinchanPlaybackUrl(result)}
                >
                  <span>{result.title}</span>
                  <small>{result.source_name}</small>
                  <Play size={15} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <dialog
          ref={dialog}
          className='shinchan-dialog'
          aria-labelledby='shinchan-dialog-title'
          onCancel={() => setSelected(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className='shinchan-dialog-heading'>
            <span className='crayon-badge'>
              <SquadColors /> 选好版本，开始放映
            </span>
            <button
              onClick={() => setSelected(null)}
              aria-label='关闭播放版本选择'
            >
              <X size={21} />
            </button>
          </div>
          <h2 id='shinchan-dialog-title'>{selected?.title}</h2>
          {resolving && (
            <p className='shinchan-loading' role='status'>
              <LoaderCircle size={17} className='animate-spin' />{' '}
              正在查找这部电影的其他译名…
            </p>
          )}
          {resolveError && (
            <p className='shinchan-notice' role='alert'>
              {resolveError}
            </p>
          )}
          <div className='shinchan-source-list'>
            {sources.map((result) => (
              <Link
                key={`${result.source}-${result.id}`}
                href={shinchanPlaybackUrl(result)}
                className='shinchan-source'
              >
                <div>
                  <strong>{result.title}</strong>
                  <span>
                    {result.source_name} · {result.episodes.length}{' '}
                    {selected?.movie ? '个播放条目' : '集'}
                    {result.year && result.year !== 'unknown'
                      ? ` · ${result.year}`
                      : ''}
                  </span>
                </div>
                <span className='shinchan-play-label'>
                  <Play size={16} /> 播放
                </span>
              </Link>
            ))}
          </div>
          {!resolving && !sources.length && (
            <div className='shinchan-no-source'>
              <Film size={30} />
              <p>当前片源暂未找到这部作品。</p>
              <p>专区会自动跟进片源上新，无需手动维护清单。</p>
              <Link
                href={`/search?q=${encodeURIComponent(
                  selected?.movie
                    ? `蜡笔小新 ${selected.movie.title}`
                    : '蜡笔小新'
                )}`}
                className='crayon-secondary-link'
              >
                前往搜索 <Search size={15} />
              </Link>
            </div>
          )}
          {sources.length > 0 && (
            <p className='shinchan-catalog-note'>
              点击版本进入播放器，可继续选集、切换片源和保存观看进度。
            </p>
          )}
        </dialog>
      </div>
    </PageLayout>
  );
}
