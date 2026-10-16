import { AdminConfig } from './admin.types';

export interface LiveChannelCount {
  key: string;
  url: string;
  ua?: string;
  epg?: string;
  count: number;
}

// Merge only refreshed counts into a fresh snapshot, never an older whole config.
export function mergeLiveChannelCounts(
  config: AdminConfig,
  updates: LiveChannelCount[]
) {
  let changed = false;
  updates.forEach((update) => {
    const source = config.LiveConfig?.find((entry) => entry.key === update.key);
    if (
      !source ||
      source.disabled ||
      source.url !== update.url ||
      (source.ua || '') !== (update.ua || '') ||
      (source.epg || '') !== (update.epg || '')
    )
      return;
    if (source.channelNumber !== update.count) {
      source.channelNumber = update.count;
      changed = true;
    }
  });
  return changed;
}
