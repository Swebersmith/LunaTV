/* eslint-disable no-constant-condition */

import { decode } from 'he';

import { getConfig } from '@/lib/config';
import { fetchLiveUpstream, readLiveText } from '@/lib/live-proxy';

const defaultUA = 'AptvPlayer/1.4.10';

export interface LiveChannels {
  channelNumber: number;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
  epgUrl: string;
  epgs: {
    [key: string]: {
      start: string;
      end: string;
      title: string;
    }[];
  };
}

const cachedLiveChannels: { [key: string]: LiveChannels } = {};
const cachedAt: Record<string, number> = {};
const epgCachedAt: Record<string, number> = {};
const cachedFingerprints: { [key: string]: string } = {};
const liveFingerprint = (source: { url: string; ua?: string; epg?: string }) =>
  JSON.stringify([source.url, source.ua || '', source.epg || '']);

export function deleteCachedLiveChannels(key: string) {
  delete cachedLiveChannels[key];
  delete cachedFingerprints[key];
  delete cachedAt[key];
  delete epgCachedAt[key];
}

export async function getCachedLiveChannels(
  key: string,
  force = false
): Promise<LiveChannels | null> {
  const config = await getConfig();
  const liveInfo = config.LiveConfig?.find(
    (live) => live.key === key && !live.disabled
  );
  if (!liveInfo) return null;
  if (
    force ||
    !cachedLiveChannels[key] ||
    cachedFingerprints[key] !== liveFingerprint(liveInfo) ||
    Date.now() - (cachedAt[key] || 0) > 5 * 60 * 1000
  ) {
    const channelNum = await refreshLiveChannels(liveInfo);
    if (channelNum === 0) {
      return null;
    }
  }
  return cachedLiveChannels[key] || null;
}

export async function refreshLiveChannels(liveInfo: {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}): Promise<number> {
  const response = await fetchLiveUpstream(
    liveInfo.url,
    liveInfo.ua || defaultUA
  );
  const data = await readLiveText(response, 8 * 1024 * 1024);
  if (!data.trimStart().startsWith('#EXTM3U'))
    throw new Error('直播源未返回有效的 M3U 频道列表');
  const result = parseM3U(liveInfo.key, data, response.url || liveInfo.url);
  const epgUrl = liveInfo.epg || result.tvgUrl;
  cachedLiveChannels[liveInfo.key] = {
    channelNumber: result.channels.length,
    channels: result.channels,
    epgUrl,
    epgs: {},
  };
  cachedAt[liveInfo.key] = Date.now();
  delete epgCachedAt[liveInfo.key];
  cachedFingerprints[liveInfo.key] = liveFingerprint(liveInfo);
  return result.channels.length;
}

// EPG is optional: fetch it only on the separate EPG request, after playback starts.
export async function getLiveEpg(key: string) {
  const channelData = await getCachedLiveChannels(key);
  if (!channelData || !channelData.epgUrl) return channelData;
  if (Date.now() - (epgCachedAt[key] || 0) < 10 * 60 * 1000) return channelData;
  const config = await getConfig();
  const live = config.LiveConfig?.find(
    (item) => item.key === key && !item.disabled
  );
  if (!live) return null;
  const epgs = await parseEpg(
    channelData.epgUrl,
    live.ua || defaultUA,
    channelData.channels.map((channel) => channel.tvgId)
  );
  if (cachedLiveChannels[key] === channelData) {
    channelData.epgs = epgs;
    epgCachedAt[key] = Date.now();
  }
  return channelData;
}

async function parseEpg(
  epgUrl: string,
  ua: string,
  tvgIds: string[]
): Promise<LiveChannels['epgs']> {
  const result: LiveChannels['epgs'] = {};
  const ids = new Set(tvgIds);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetchLiveUpstream(epgUrl, ua);
    reader = response.body?.getReader();
    if (!reader) return result;
    timer = setTimeout(() => {
      void reader?.cancel().catch(() => undefined);
    }, 15000);
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      const programme = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
      let consumed = 0;
      while ((match = programme.exec(buffer))) {
        consumed = programme.lastIndex;
        const id = decode(
          match[1].match(/channel=["']([^"']+)["']/)?.[1] || ''
        );
        if (!ids.has(id)) continue;
        const start = match[1].match(/start=["']([^"']+)["']/)?.[1];
        const end = match[1].match(/stop=["']([^"']+)["']/)?.[1];
        const title = match[2].match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1];
        if (start && end && title) {
          if (!result[id]) result[id] = [];
          if (result[id].length < 2000)
            result[id].push({
              start,
              end,
              title: decode(title.replace(/<[^>]*>/g, '')),
            });
        }
      }
      buffer = buffer.slice(consumed);
      // Malformed XML must not accumulate an unbounded buffer.
      if (buffer.length > 512 * 1024) break;
    }
  } catch {
    /* A missing programme guide must never prevent watching a channel. */
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
  return result;
}

/**
 * 解析M3U文件内容，提取频道信息
 * @param m3uContent M3U文件的内容字符串
 * @returns 频道信息数组
 */
export function parseM3U(
  sourceKey: string,
  m3uContent: string,
  playlistUrl = ''
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const absolute = (value: string) => {
    if (!value) return '';
    try {
      return new URL(value, playlistUrl).href;
    } catch {
      return value;
    }
  };
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = m3uContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let tvgUrl = '';
  let channelIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是 #EXTM3U 行，提取 tvg-url
    if (line.startsWith('#EXTM3U')) {
      // 支持两种格式：x-tvg-url 和 url-tvg
      const tvgUrlMatch = line.match(/(?:x-tvg-url|url-tvg)="([^"]*)"/);
      tvgUrl = tvgUrlMatch ? absolute(tvgUrlMatch[1].split(',')[0].trim()) : '';
      continue;
    }

    // 检查是否是 #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      // 提取 tvg-id
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';

      // 提取 tvg-name
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';

      // 提取 tvg-logo
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const logo = tvgLogoMatch ? tvgLogoMatch[1] : '';

      // 提取 group-title
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const group = groupTitleMatch ? groupTitleMatch[1] : '无分组';

      // 提取标题（#EXTINF 行最后的逗号后面的内容）
      const titleMatch = line.match(/,([^,]*)$/);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // 优先使用 tvg-name，如果没有则使用标题
      const name = title || tvgName || '';

      // IPTV lists may place EXTVLCOPT/EXTGRP tags between metadata and the URL.
      let next = i + 1;
      while (
        next < lines.length &&
        lines[next].startsWith('#') &&
        !lines[next].startsWith('#EXTINF:')
      )
        next++;
      if (next < lines.length && !lines[next].startsWith('#')) i = next - 1;
      // 检查下一行是否是URL
      if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        const url = absolute(lines[i + 1]);

        // 只有当有名称和URL时才添加到结果中
        if (name && url) {
          channels.push({
            id: `${sourceKey}-${channelIndex}`,
            tvgId,
            name,
            logo: absolute(logo),
            group,
            url,
          });
          channelIndex++;
        }

        // 跳过下一行，因为已经处理了
        i++;
      }
    }
  }

  return { tvgUrl, channels };
}

// utils/urlResolver.js
export function resolveUrl(baseUrl: string, relativePath: string) {
  try {
    // 如果已经是完整的 URL，直接返回
    if (
      relativePath.startsWith('http://') ||
      relativePath.startsWith('https://')
    ) {
      return relativePath;
    }

    // 如果是协议相对路径 (//example.com/path)
    if (relativePath.startsWith('//')) {
      const baseUrlObj = new URL(baseUrl);
      return `${baseUrlObj.protocol}${relativePath}`;
    }

    // 使用 URL 构造函数处理相对路径
    const baseUrlObj = new URL(baseUrl);
    const resolvedUrl = new URL(relativePath, baseUrlObj);
    return resolvedUrl.href;
  } catch (error) {
    // 降级处理
    return fallbackUrlResolve(baseUrl, relativePath);
  }
}

function fallbackUrlResolve(baseUrl: string, relativePath: string) {
  // 移除 baseUrl 末尾的文件名，保留目录路径
  let base = baseUrl;
  if (!base.endsWith('/')) {
    base = base.substring(0, base.lastIndexOf('/') + 1);
  }

  // 处理不同类型的相对路径
  if (relativePath.startsWith('/')) {
    // 绝对路径 (/path/to/file)
    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}${relativePath}`;
  } else if (relativePath.startsWith('../')) {
    // 上级目录相对路径 (../path/to/file)
    const segments = base.split('/').filter((s) => s);
    const relativeSegments = relativePath.split('/').filter((s) => s);

    for (const segment of relativeSegments) {
      if (segment === '..') {
        segments.pop();
      } else if (segment !== '.') {
        segments.push(segment);
      }
    }

    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}/${segments.join('/')}`;
  } else {
    // 当前目录相对路径 (file.ts 或 ./file.ts)
    const cleanRelative = relativePath.startsWith('./')
      ? relativePath.slice(2)
      : relativePath;
    return base + cleanRelative;
  }
}

// 获取 M3U8 的基础 URL
export function getBaseUrl(m3u8Url: string) {
  try {
    const url = new URL(m3u8Url);
    // 如果 URL 以 .m3u8 结尾，移除文件名
    if (url.pathname.endsWith('.m3u8')) {
      url.pathname = url.pathname.substring(
        0,
        url.pathname.lastIndexOf('/') + 1
      );
    } else if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return url.protocol + '//' + url.host + url.pathname;
  } catch (error) {
    return m3u8Url.endsWith('/') ? m3u8Url : m3u8Url + '/';
  }
}
