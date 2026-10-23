import { handlePlayerMedia } from '@/lib/player-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return (await handlePlayerMedia(request, { PASSWORD: process.env.PASSWORD })) || new Response(null,{status:404});
}
export const HEAD = GET;
export const OPTIONS = GET;
