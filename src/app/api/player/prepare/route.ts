import { handlePlayerMedia } from '@/lib/player-media';
import { getStorageType } from '@/lib/storage-type';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return (await handlePlayerMedia(request, { PASSWORD: process.env.PASSWORD, STORAGE_TYPE: getStorageType() })) || new Response(null,{status:404});
}
