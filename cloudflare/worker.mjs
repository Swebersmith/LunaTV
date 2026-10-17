// Keep account-specific resource selection in the Cloudflare dashboard.
export function resolveEnvironment(env) {
  const d1 = env.LUNATV_D1 || env.DB;
  const explicit = env.STORAGE_TYPE && env.STORAGE_TYPE !== 'auto';
  return {
    ...env,
    ...(d1 ? { LUNATV_D1: d1 } : {}),
    STORAGE_TYPE: explicit
      ? env.STORAGE_TYPE
      : d1
      ? 'cloudflare-d1'
      : env.NEXT_PUBLIC_STORAGE_TYPE ||
        (env.LUNATV_KV ? 'cloudflare-kv' : 'localstorage'),
  };
}

export function createWorker(handler, handleMedia = () => null) {
  return {
    async fetch(request, env, ctx) {
      const resolved = resolveEnvironment(env);
      const media = await handleMedia(request, resolved);
      return media || handler.fetch(request, resolved, ctx);
    },
    async scheduled(_event, env, ctx) {
      if (!env.CRON_SECRET) {
        throw new Error(
          'Set CRON_SECRET in Cloudflare before enabling Cron Triggers'
        );
      }
      // Invoke the application directly; no public URL or account ID is needed.
      const response = await handler.fetch(
        new Request('https://lunatv.internal/api/cron', {
          headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        }),
        resolveEnvironment(env),
        ctx
      );
      await response.arrayBuffer();
      if (!response.ok)
        throw new Error(`Scheduled refresh failed (${response.status})`);
    },
  };
}
