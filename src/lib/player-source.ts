import { sourceToFilteredTime } from './vod-segment-filter';
import { createMediaPreparer } from '../../packages/crayon-player/src/media-client';

export const preparePlayerSource = createMediaPreparer();

export async function prepareCastSource(source: { url: string; title?: string }, blockAds: boolean) {
  const prepared = await preparePlayerSource(source.url,blockAds);
  return { ...source, ...prepared, mapTime: (time: number) => sourceToFilteredTime(prepared.filter.removed,time) };
}
