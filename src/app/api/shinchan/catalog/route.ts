import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { CatalogCache, getShinchanCatalog } from '@/lib/shinchan-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!getAuthInfoFromCookie(request)?.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const edgeCaches = globalThis.caches as
    | (CacheStorage & { default?: CatalogCache })
    | undefined;
  const snapshot = await getShinchanCatalog(new URL(request.url).origin, {
    cache: edgeCaches?.default,
  });
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'private,no-store' },
  });
}
