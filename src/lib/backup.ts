import { z } from 'zod';

import { AdminConfig } from './admin.types';
import { StorageBackup } from './types';

const record = z
  .object({
    title: z.string(),
    source_name: z.string(),
    cover: z.string(),
    year: z.string(),
    index: z.number(),
    total_episodes: z.number(),
    play_time: z.number(),
    total_time: z.number(),
    save_time: z.number(),
    search_title: z.string(),
  })
  .passthrough();
const favorite = record
  .omit({ index: true, play_time: true, total_time: true })
  .extend({ origin: z.enum(['vod', 'live']).optional() });
const skip = z.object({
  enable: z.boolean(),
  intro_time: z.number(),
  outro_time: z.number(),
});
const keyed = <T extends z.ZodTypeAny>(value: T) =>
  z.record(
    z.string().refine((key) => key.indexOf('+') > 0 && !key.endsWith('+')),
    value
  );
const schema = z.object({
  adminConfig: z.custom<AdminConfig>((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const config = value as AdminConfig;
    return (
      config.SiteConfig &&
      typeof config.SiteConfig === 'object' &&
      (!config.UserConfig ||
        (Array.isArray(config.UserConfig.Users) &&
          config.UserConfig.Users.every(
            (user) =>
              user &&
              typeof user.username === 'string' &&
              ['user', 'admin', 'owner'].includes(user.role)
          )))
    );
  }),
  userData: z.record(
    z.string().min(1),
    z.object({
      password: z.string().nullable().optional(),
      playRecords: keyed(record).optional(),
      favorites: keyed(favorite).optional(),
      searchHistory: z.array(z.string()).max(20).optional(),
      skipConfigs: keyed(skip).optional(),
    })
  ),
});

// Validate the complete payload before any storage is cleared.
export function parseBackup(value: unknown): StorageBackup {
  return schema.parse(value);
}
