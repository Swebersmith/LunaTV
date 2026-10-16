import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { convertKVEntry, migrate } from './migrate-kv-to-d1.mjs';

const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve('miniflare', {
  paths: [require.resolve('wrangler/package.json')],
}));

test('copies paginated KV data without modifying KV, preserves hashes and reruns safely', async (context) => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: '2025-04-01',
    d1Databases: ['DB'],
  });
  context.after(() => runtime.dispose());
  const database = await runtime.getD1Database('DB');
  const schema = readFileSync(
    new URL('../migrations/0001_storage.sql', import.meta.url),
    'utf8'
  );
  await database.batch(
    schema
      .split(';')
      .filter((sql) => sql.trim())
      .map((sql) => database.prepare(sql))
  );
  const entries = new Map([
    ['admin:config', JSON.stringify({ ConfigFile: '', SourceConfig: [] })],
    ['u:alice:pwd', JSON.stringify('existing-salted-hash')],
    ['u:alice:pr', JSON.stringify({ 'source+1': { play_time: 25 } })],
    ['u:alice:fav', JSON.stringify({ 'source+2': { title: 'Movie' } })],
    ['u:alice:skip', JSON.stringify({ 'source+1': { intro_time: 10 } })],
    ['u:alice:sh', JSON.stringify(['newest', 'older'])],
    ['sys:users', JSON.stringify(['alice'])],
    ['cache:ignored', 'not JSON'],
  ]);
  let mutations = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/query')) {
      const body = JSON.parse(options.body);
      const statements = body.batch ?? [{ sql: body.sql, params: body.params }];
      const result = [];
      for (const { sql, params = [] } of statements) {
        if (sql.startsWith('SELECT')) {
          result.push({ success: true, results: [] });
          continue;
        }
        const { meta } = await database
          .prepare(sql)
          .bind(...params)
          .run();
        mutations += meta.changes;
        result.push({ success: true, meta: { changes: meta.changes } });
      }
      return Response.json({ success: true, result });
    }
    // The migration may only GET from the source namespace.
    assert.ok(!options.method || options.method === 'GET');
    if (parsed.pathname.endsWith('/keys')) {
      const keys = [...entries.keys()];
      const secondPage = parsed.searchParams.has('cursor');
      return Response.json({
        success: true,
        result: (secondPage ? keys.slice(3) : keys.slice(0, 3)).map((name) => ({
          name,
        })),
        result_info: { cursor: secondPage ? '' : 'next' },
      });
    }
    const key = decodeURIComponent(parsed.pathname.split('/values/')[1]);
    return new Response(entries.get(key));
  };
  const options = {
    accountId: 'account',
    namespaceId: 'kv',
    databaseId: 'd1',
    token: 'test-only',
    fetchImpl,
  };
  const dryRun = await migrate(options);
  assert.equal(dryRun.keys, 6);
  assert.equal(dryRun.rows, 6);
  assert.equal(mutations, 0);
  const first = await migrate({ ...options, write: true });
  assert.equal(first.inserted, 6);
  assert.equal(
    await database
      .prepare('SELECT password FROM users WHERE username = ?')
      .bind('alice')
      .first('password'),
    'existing-salted-hash'
  );
  assert.deepEqual(
    JSON.parse(
      await database
        .prepare("SELECT value FROM user_data WHERE kind = 'search'")
        .first('value')
    ),
    ['newest', 'older']
  );
  await database
    .prepare("UPDATE user_data SET value = ? WHERE kind = 'play'")
    .bind(JSON.stringify({ play_time: 99 }))
    .run();
  const second = await migrate({ ...options, write: true });
  assert.equal(second.inserted, 0);
  assert.equal(
    JSON.parse(
      await database
        .prepare("SELECT value FROM user_data WHERE kind = 'play'")
        .first('value')
    ).play_time,
    99
  );
});

test('fails on malformed data without including sensitive source content', () => {
  assert.throws(
    () => convertKVEntry('u:alice:pwd', 'secret-content'),
    (error) => !error.message.includes('secret-content')
  );
  assert.throws(() => convertKVEntry('u:alice:pr', '[]'));
});

test('stops on a failed D1 API result', async () => {
  await assert.rejects(
    migrate({
      accountId: 'account',
      namespaceId: 'kv',
      databaseId: 'd1',
      token: 'test-only',
      fetchImpl: async () =>
        Response.json({ success: true, result: [{ success: false }] }),
    }),
    /unsuccessful/
  );
});
