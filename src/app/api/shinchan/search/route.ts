import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchPageFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private,no-store' };

export async function GET(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sources = await getAvailableApiSites(username);
  const params = new URL(request.url).searchParams;
  const key = params.get('source');
  if (!key)
    return NextResponse.json(
      { sources: sources.map(({ key, name }) => ({ key, name })) },
      { headers }
    );
  const source = sources.find((site) => site.key === key);
  if (!source)
    return NextResponse.json({ error: '片源不可用' }, { status: 403, headers });
  const query = params.get('q') || '蜡笔小新';
  const page = Number(params.get('page') || 1);
  if (
    !['蜡笔小新', '蠟筆小新', 'クレヨンしんちゃん'].includes(query) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100
  )
    return NextResponse.json(
      { error: '检索参数错误' },
      { status: 400, headers }
    );
  const data = await searchPageFromApi(source, query, page);
  if (data.failed)
    return NextResponse.json(
      { error: '片源暂不可用，稍后自动重试' },
      { status: 503, headers }
    );
  const config = await getConfig();
  const results = config.SiteConfig.DisableYellowFilter
    ? data.results
    : data.results.filter(
        (result) =>
          !yellowWords.some((word) => (result.type_name || '').includes(word))
      );
  return NextResponse.json(
    { results, pageCount: data.pageCount || 1 },
    { headers }
  );
}
