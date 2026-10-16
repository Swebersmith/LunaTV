import { NextRequest, NextResponse } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateJson = (body: unknown, init?: ResponseInit) =>
  NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'private, no-store', ...init?.headers },
  });
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return privateJson({ error: '缺少直播源参数' }, { status: 400 });
    }

    const channelData = await getCachedLiveChannels(
      sourceKey,
      searchParams.get('refresh') === '1'
    );

    if (!channelData) {
      return privateJson({ error: '频道信息未找到' }, { status: 404 });
    }

    return privateJson({
      success: true,
      data: channelData.channels,
    });
  } catch (error) {
    return privateJson({ error: '获取频道信息失败' }, { status: 500 });
  }
}
