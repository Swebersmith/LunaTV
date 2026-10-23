import { handleMediaRelay } from '../../packages/crayon-player/src/media-relay';

interface Environment { PASSWORD?: string; STORAGE_TYPE?: string }
const encoder = new TextEncoder();
const keyFor = (secret: string) => crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);

async function loggedIn(request: Request, env: Environment, key: CryptoKey) {
  try {
    const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)auth=([^;]+)/)?.[1];
    if (!cookie || cookie.length > 8192) return false;
    let value = decodeURIComponent(cookie);
    if (!value.trimStart().startsWith('{')) value = decodeURIComponent(value);
    const auth = JSON.parse(value);
    if (env.STORAGE_TYPE === 'localstorage') {
      if (typeof auth.password !== 'string' || !auth.password) return false;
      const candidate = await keyFor(auth.password);
      const message = encoder.encode('crayon-player-local-auth');
      return crypto.subtle.verify('HMAC',candidate,await crypto.subtle.sign('HMAC',key,message),message);
    }
    if (!auth.username || typeof auth.username !== 'string' || !/^[0-9a-f]{64}$/i.test(auth.signature || '')) return false;
    const signature = Uint8Array.from((auth.signature as string).match(/../g) || [], hex => parseInt(hex,16));
    return crypto.subtle.verify('HMAC', key, signature, encoder.encode(auth.username));
  } catch { return false; }
}


/** Existing website authentication adapts the portable player relay. */
export async function handlePlayerMedia(request: Request, env: Environment): Promise<Response | null> {
  return handleMediaRelay(request,{
    secret: env.PASSWORD || '',
    authorize: async request => !!env.PASSWORD && loggedIn(request,env,await keyFor(env.PASSWORD)),
  });
}
