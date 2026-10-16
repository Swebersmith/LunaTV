import he from 'he';

import {
  mergeShinchanMovies,
  movieTitle,
  normalizeShinchanTitle,
  SHINCHAN_MOVIES,
  ShinchanMovie,
} from './shinchan-catalog';

export const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const USER_AGENT =
  'Swebersmith/CrayonTV/1.0 (https://github.com/Swebersmith/LunaTV)';
export const OFFICIAL_HISTORY = 'https://www.shinchan-app.jp/about/index.php';
const BANGUMI_SEARCH = 'https://api.bgm.tv/v0/search/subjects';

export interface ShinchanCatalogSnapshot {
  movies: ShinchanMovie[];
  checkedAt: string;
  nextCheckAt: string;
  status: 'current' | 'partial' | 'stale' | 'fallback';
  official: boolean;
  bangumi: boolean;
}

// Public metadata only. No user data, bindings, or in-flight promises are shared.
let memory: ShinchanCatalogSnapshot | undefined;
export type CatalogCache = Pick<Cache, 'match' | 'put'>;

export function parseOfficialHistory(html: string): ShinchanMovie[] {
  const text = he.decode(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(?:div|p|li|h\d)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
  let year = 0,
    month = 0;
  const movies: ShinchanMovie[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const yearMatch = line.match(/^(\d{4})年$/);
    if (yearMatch) {
      year = Number(yearMatch[1]);
      month = 0;
      continue;
    }
    const monthMatch = line.match(/^(\d{1,2})月$/);
    if (monthMatch) {
      month = Number(monthMatch[1]);
      continue;
    }
    if (
      !year ||
      !/劇場映画|3DCGアニメーション/.test(line) ||
      /実写化|実写映画/.test(line)
    )
      continue;
    const title = line.match(/『([^』]+)』[^\n]*公開/);
    if (!title) continue;
    const name = movieTitle(title[1]);
    movies.push({
      id: `official-${year}-${normalizeShinchanTitle(name)}`,
      year,
      title: name,
      aliases: [title[1]],
      releaseDate: month
        ? `${year}-${String(month).padStart(2, '0')}`
        : String(year),
      officialReleaseDate: month
        ? `${year}-${String(month).padStart(2, '0')}`
        : String(year),
      origin: 'official',
    });
  }
  if (movies.length < 20) throw new Error('官方目录格式变化，保留已有目录');
  return movies;
}

export function parseBangumiMovies(value: unknown): ShinchanMovie[] {
  if (!Array.isArray(value)) throw new Error('条目目录格式异常');
  return value.flatMap((subject) => {
    if (
      !subject ||
      subject.type !== 2 ||
      subject.platform !== '剧场版' ||
      typeof subject.name !== 'string' ||
      !/クレヨンしんちゃん|蜡笔小新|蠟筆小新|crayon\s*shinchan/i.test(
        `${subject.name} ${subject.name_cn || ''}`
      )
    )
      return [];
    if (
      !Number.isInteger(subject.id) ||
      !/^\d{4}(?:-\d{2}){0,2}$/.test(subject.date || '')
    )
      return [];
    const title = movieTitle(subject.name_cn || subject.name);
    const wikiAliases = Array.isArray(subject.infobox)
      ? subject.infobox
          .filter((item: { key?: string }) => item.key === '别名')
          .flatMap((item: { value?: unknown }) =>
            typeof item.value === 'string'
              ? [item.value]
              : Array.isArray(item.value)
              ? item.value
                  .map((alias) => alias?.v)
                  .filter((alias): alias is string => typeof alias === 'string')
              : []
          )
      : [];
    const special = /プラネタリウム|planetarium|天象电影|天象映|天象厅/i.test(
      JSON.stringify(subject.infobox || [])
    );
    return [
      {
        id: `bangumi-${subject.id}`,
        year: Number(subject.date.slice(0, 4)),
        title,
        aliases: [subject.name, subject.name_cn, ...wikiAliases].filter(
          (name): name is string => typeof name === 'string' && !!name
        ),
        releaseDate: subject.date,
        origin: 'bangumi' as const,
        ...(special ? { edition: 'special-screening' as const } : {}),
      },
    ];
  });
}

async function boundedText(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('目录服务暂不可用');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) throw new Error('目录响应超出限制');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function bangumiCatalog(
  fetcher: typeof fetch,
  signal: AbortSignal,
  year: number
): Promise<ShinchanMovie[]> {
  async function page(offset: number, recent: boolean) {
    const response = await fetcher(
      `${BANGUMI_SEARCH}?limit=20&offset=${offset}`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keyword: 'クレヨンしんちゃん',
          filter: {
            type: [2],
            nsfw: false,
            ...(recent ? { air_date: [`>=${year - 2}-01-01`] } : {}),
          },
        }),
        signal,
        cache: 'no-store',
      }
    );
    const data = JSON.parse(await boundedText(response));
    if (!Array.isArray(data.data) || !Number.isFinite(data.total))
      throw new Error('条目目录格式异常');
    return data as { data: unknown[]; total: number };
  }
  // The recent query still discovers new releases if the historical search grows large.
  const recent = await page(0, true);
  const movies = parseBangumiMovies(recent.data);
  let offset = 0;
  for (let count = 0; count < 8; count++) {
    const data = await page(offset, false);
    movies.push(...parseBangumiMovies(data.data));
    offset += data.data.length; // The service may return fewer items than requested.
    if (offset >= data.total || !data.data.length) return movies;
  }
  return movies;
}

export async function getShinchanCatalog(
  origin: string,
  options: { cache?: CatalogCache; fetcher?: typeof fetch; now?: number } = {}
): Promise<ShinchanCatalogSnapshot> {
  const now = options.now ?? Date.now(),
    fetcher = options.fetcher ?? fetch;
  const key = new URL('/__crayontv/shinchan-catalog-v1', origin).toString();
  let previous = memory;
  try {
    const cached = await options.cache?.match(key);
    if (cached) {
      const data = (await cached.json()) as ShinchanCatalogSnapshot;
      if (Array.isArray(data.movies) && data.movies.length && data.nextCheckAt)
        previous = data;
    }
  } catch {
    /* Cache availability never controls catalog availability. */
  }
  if (previous && Date.parse(previous.nextCheckAt) > now) return previous;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  const results = await Promise.allSettled([
    (async () =>
      parseOfficialHistory(
        await boundedText(
          await fetcher(OFFICIAL_HISTORY, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
            cache: 'no-store',
          })
        )
      ))(),
    bangumiCatalog(fetcher, controller.signal, new Date(now).getUTCFullYear()),
  ]);
  clearTimeout(timeout);
  const official = results[0].status === 'fulfilled',
    bangumi = results[1].status === 'fulfilled';
  const movies = mergeShinchanMovies(
    SHINCHAN_MOVIES,
    previous?.movies ?? [],
    results[0].status === 'fulfilled' ? results[0].value : [],
    results[1].status === 'fulfilled' ? results[1].value : []
  );
  const snapshot: ShinchanCatalogSnapshot = {
    movies,
    checkedAt: new Date(now).toISOString(),
    nextCheckAt: new Date(
      now + (official && bangumi ? CATALOG_REFRESH_MS : RETRY_MS)
    ).toISOString(),
    status:
      official && bangumi
        ? 'current'
        : official || bangumi
        ? 'partial'
        : previous
        ? 'stale'
        : 'fallback',
    official,
    bangumi,
  };
  memory = snapshot;
  try {
    await options.cache?.put(
      key,
      new Response(JSON.stringify(snapshot), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public,max-age=604800',
        },
      })
    );
  } catch {
    /* Keep the successfully loaded data in memory if edge cache is unavailable. */
  }
  return snapshot;
}
