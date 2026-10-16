import { MetadataRoute } from 'next';

import branding from '@/lib/branding.json';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const config = await getConfig();
  const name = config.SiteConfig.SiteName || branding.name;
  return {
    name,
    short_name: name,
    description: branding.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: branding.themeColor,
    background_color: branding.backgroundColor,
    icons: [192, 256, 384, 512].map((size) => ({
      src: `/icons/icon-${size}x${size}.png?v=${branding.assetVersion}`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any' as const,
    })),
  };
}
