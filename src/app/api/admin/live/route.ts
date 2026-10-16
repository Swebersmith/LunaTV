import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { deleteCachedLiveChannels } from '@/lib/live';
import { parseLiveSourceInput } from '@/lib/source-input';
import { getStorageType } from '@/lib/storage-type';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (getStorageType() === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const config: AdminConfig = JSON.parse(JSON.stringify(await getConfig()));
    if (username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (entry) => entry.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }
    const body = await request.json();
    const { action, key } = body;
    const sources = config.LiveConfig || [];
    config.LiveConfig = sources;
    const existing = sources.find((entry) => entry.key === key);
    let invalidate = false;
    let needsRefresh = false;

    if (action === 'add' || action === 'edit') {
      let input: ReturnType<typeof parseLiveSourceInput>;
      try {
        input = parseLiveSourceInput(body);
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 }
        );
      }
      if (action === 'add') {
        if (sources.some((entry) => entry.key === input.key)) {
          return NextResponse.json(
            { error: '直播源 key 已存在' },
            { status: 400 }
          );
        }
        sources.push({
          ...input,
          from: 'custom',
          channelNumber: 0,
          disabled: false,
        });
        needsRefresh = true;
      } else {
        const target = sources.find((entry) => entry.key === input.key);
        if (!target)
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        needsRefresh =
          target.url !== input.url ||
          (target.ua || '') !== input.ua ||
          (target.epg || '') !== input.epg;
        Object.assign(target, input, { overridden: true });
        if (needsRefresh) target.channelNumber = 0;
        invalidate = needsRefresh;
      }
    } else if (action === 'sort') {
      if (
        !Array.isArray(body.order) ||
        !body.order.every((item: unknown) => typeof item === 'string')
      ) {
        return NextResponse.json(
          { error: '排序数据格式错误' },
          { status: 400 }
        );
      }
      const remaining = new Map(sources.map((entry) => [entry.key, entry]));
      config.LiveConfig = [];
      body.order.forEach((item: string) => {
        const source = remaining.get(item);
        if (source) {
          config.LiveConfig?.push(source);
          remaining.delete(item);
        }
      });
      config.LiveConfig.push(...Array.from(remaining.values()));
    } else if (['enable', 'disable', 'delete'].includes(action)) {
      if (typeof key !== 'string' || !key)
        return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
      if (!existing)
        return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
      if (action === 'delete') {
        if (existing.from === 'config') {
          return NextResponse.json(
            { error: '不能删除配置文件中的直播源' },
            { status: 400 }
          );
        }
        config.LiveConfig = sources.filter((entry) => entry.key !== key);
        invalidate = true;
      } else {
        existing.disabled = action === 'disable';
      }
    } else {
      return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // Save immediately; downloading playlists and EPGs belongs to playback/refresh.
    await db.saveAdminConfig(config);
    if (invalidate) deleteCachedLiveChannels(key);
    return NextResponse.json(
      { success: true, sources: config.LiveConfig, needsRefresh },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}
