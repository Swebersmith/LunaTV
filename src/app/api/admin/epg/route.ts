import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { parseEpgSourceInput } from '@/lib/source-input';
import { getStorageType } from '@/lib/storage-type';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const username = getAuthInfoFromCookie(request)?.username;
  if (!username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (getStorageType() === 'localstorage')
    return NextResponse.json(
      { error: '请使用数据库存储节目单源配置' },
      { status: 400 }
    );
  try {
    // Copy the latest stored configuration; never publish an unsaved mutation.
    const config = JSON.parse(JSON.stringify(await getConfig())) as Awaited<
      ReturnType<typeof getConfig>
    >;
    if (username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (entry) => entry.username === username
      );
      if (!user || user.role !== 'admin' || user.banned)
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
    const sources = config.EpgConfig || [];
    config.EpgConfig = sources;
    const existing = sources.find((source) => source.key === body.key);
    if (body.action === 'add' || body.action === 'edit') {
      let input: ReturnType<typeof parseEpgSourceInput>;
      try {
        input = parseEpgSourceInput(body);
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 }
        );
      }
      if (body.action === 'add') {
        if (existing)
          return NextResponse.json(
            { error: '节目单源标识已存在' },
            { status: 400 }
          );
        sources.push({ ...input, disabled: false });
      } else {
        if (!existing)
          return NextResponse.json(
            { error: '节目单源不存在' },
            { status: 404 }
          );
        Object.assign(existing, input);
      }
    } else if (body.action === 'sort') {
      if (
        !Array.isArray(body.order) ||
        body.order.length !== sources.length ||
        new Set(body.order).size !== sources.length ||
        !body.order.every(
          (key: unknown) =>
            typeof key === 'string' &&
            sources.some((source) => source.key === key)
        )
      ) {
        return NextResponse.json(
          { error: '节目单源列表已变化，请刷新后重试排序' },
          { status: 400 }
        );
      }
      config.EpgConfig = body.order.map((key: string) =>
        sources.find((source) => source.key === key)
      );
    } else if (['enable', 'disable', 'delete'].includes(body.action)) {
      if (!existing)
        return NextResponse.json({ error: '节目单源不存在' }, { status: 404 });
      if (body.action === 'delete')
        config.EpgConfig = sources.filter((source) => source.key !== body.key);
      else existing.disabled = body.action === 'disable';
    } else return NextResponse.json({ error: '未知操作' }, { status: 400 });
    // No guide downloads or database writes on the viewer's playback path.
    await db.saveAdminConfig(config);
    return NextResponse.json(
      { success: true, sources: config.EpgConfig },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: '节目单源保存失败，请重试' },
      { status: 500 }
    );
  }
}
