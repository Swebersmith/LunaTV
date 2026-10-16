'use client';

import { fetchClientJson } from './client-request';

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

export async function GetBangumiCalendarData(signal?: AbortSignal): Promise<BangumiCalendarData[]> {
  const data = await fetchClientJson<BangumiCalendarData[]>('/api/bangumi/calendar', signal);
  if (!Array.isArray(data)) throw new Error('番剧日历暂时无法加载，请稍后重试。');
  const filteredData = data.map((item: BangumiCalendarData) => ({
    ...item,
    items: item.items.filter(bangumiItem => bangumiItem.images)
  }));

  return filteredData;
}
