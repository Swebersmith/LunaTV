import { NextRequest, NextResponse } from 'next/server';

import { getLiveEpg } from '@/lib/live';

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
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey) {
      return privateJson({ error: '缺少直播源参数' }, { status: 400 });
    }

    if (!tvgId) {
      return privateJson({ error: '缺少频道tvg-id参数' }, { status: 400 });
    }

    const channelData = await getLiveEpg(sourceKey);

    if (!channelData) {
      // 频道信息未找到时返回空的节目单数据
      return privateJson({
        success: true,
        data: {
          tvgId,
          source: sourceKey,
          epgUrl: '',
          programs: [],
        },
      });
    }

    // 从epgs字段中获取对应tvgId的节目单信息
    const epgData = channelData.epgs[tvgId] || [];

    return privateJson({
      success: true,
      data: {
        tvgId,
        source: sourceKey,
        epgUrl: channelData.epgUrl,
        programs: epgData,
      },
    });
  } catch (error) {
    return privateJson({ error: '获取节目单信息失败' }, { status: 500 });
  }
}
