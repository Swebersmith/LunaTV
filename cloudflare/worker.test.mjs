import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWorker, resolveEnvironment } from './worker.mjs';

test('media bypasses the framework while retaining resolved bindings and authentication failures', async () => {
  let applicationCalls = 0;
  const env = { DB: { prepare() {} } };
  const worker = createWorker(
    {
      fetch() {
        applicationCalls++;
        return new Response('page');
      },
    },
    (request, resolved) => {
      assert.equal(resolved.LUNATV_D1, env.DB);
      assert.equal(resolved.STORAGE_TYPE, 'cloudflare-d1');
      return new URL(request.url).pathname.startsWith('/api/proxy/')
        ? new Response('Unauthorized', { status: 401 })
        : null;
    }
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://example.test/api/proxy/segment'),
        env,
        {}
      )
    ).status,
    401
  );
  assert.equal(applicationCalls, 0);
  assert.equal(
    await (
      await worker.fetch(new Request('https://example.test/'), env, {})
    ).text(),
    'page'
  );
  assert.equal(applicationCalls, 1);
});

test('D1 needs only a dashboard binding, including when an old public build variable selects KV', () => {
  const database = { prepare() {} };
  const env = { DB: database, NEXT_PUBLIC_STORAGE_TYPE: 'cloudflare-kv' };
  const resolved = resolveEnvironment(env);
  assert.equal(resolved.LUNATV_D1, database);
  assert.equal(resolved.STORAGE_TYPE, 'cloudflare-d1');
  assert.equal(env.STORAGE_TYPE, undefined);
  assert.equal(
    resolveEnvironment({ LUNATV_D1: database }).STORAGE_TYPE,
    'cloudflare-d1'
  );
  assert.equal(
    resolveEnvironment({ ...env, STORAGE_TYPE: 'auto' }).STORAGE_TYPE,
    'cloudflare-d1'
  );
  assert.equal(
    resolveEnvironment({ ...env, STORAGE_TYPE: 'cloudflare-kv' }).STORAGE_TYPE,
    'cloudflare-kv'
  );
  assert.equal(
    resolveEnvironment({ LUNATV_KV: {} }).STORAGE_TYPE,
    'cloudflare-kv'
  );
  assert.equal(resolveEnvironment({}).STORAGE_TYPE, 'localstorage');
});

test('HTTP and native scheduled handlers use the same D1 environment', async () => {
  const calls = [];
  const handler = createWorker({
    fetch(request, env) {
      calls.push({ request, env });
      return new Response('ok');
    },
  });
  const env = { LUNATV_D1: {}, CRON_SECRET: 'private-test-secret' };
  await handler.fetch(new Request('https://example.test/'), env, {});
  await handler.scheduled({}, env, {});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].env.STORAGE_TYPE, 'cloudflare-d1');
  assert.equal(calls[1].env.STORAGE_TYPE, 'cloudflare-d1');
  assert.equal(new URL(calls[1].request.url).pathname, '/api/cron');
  assert.equal(
    calls[1].request.headers.get('authorization'),
    'Bearer private-test-secret'
  );
});

test('scheduled failures are reported and missing credentials never invoke the application', async () => {
  let calls = 0;
  const handler = createWorker({
    fetch() {
      calls++;
      return new Response('failed', { status: 500 });
    },
  });
  await assert.rejects(handler.scheduled({}, {}, {}), /CRON_SECRET/);
  assert.equal(calls, 0);
  await assert.rejects(
    handler.scheduled({}, { CRON_SECRET: 'test' }, {}),
    /500/
  );
  assert.equal(calls, 1);
});
