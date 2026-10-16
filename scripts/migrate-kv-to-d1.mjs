#!/usr/bin/env node
/* eslint-disable no-console */
import { pathToFileURL } from 'node:url';

// Only application keys are copied. KV is never modified. Inserts deliberately
// preserve existing D1 rows, so an interrupted migration can safely be rerun.
export function convertKVEntry(key, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      'Invalid JSON in KV; check the source data before migrating'
    );
  }
  if (key === 'admin:config') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid admin config');
    return [
      {
        sql: 'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT DO NOTHING',
        params: [key, raw],
      },
    ];
  }
  const match = /^u:(.*):(pwd|pr|fav|sh|skip)$/.exec(key);
  if (!match) return [];
  const [, username, suffix] = match;
  if (suffix === 'pwd') {
    if (typeof value !== 'string') throw new Error('Invalid password entry');
    return [
      {
        sql: 'INSERT INTO users (username, password) VALUES (?1, ?2) ON CONFLICT DO NOTHING',
        params: [username, value],
      },
    ];
  }
  const kind = { pr: 'play', fav: 'favorite', skip: 'skip', sh: 'search' }[
    suffix
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    (suffix === 'sh' ? !Array.isArray(value) : Array.isArray(value))
  ) {
    throw new Error('Invalid user collection');
  }
  const entries =
    suffix === 'sh' ? [['', value.slice(0, 20)]] : Object.entries(value);
  return entries.map(([itemKey, item]) => ({
    sql: 'INSERT INTO user_data (username, kind, item_key, value) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING',
    params: [username, kind, itemKey, JSON.stringify(item)],
  }));
}

export async function migrate({
  accountId,
  namespaceId,
  databaseId,
  token,
  write = false,
  fetchImpl = fetch,
}) {
  for (const field of [accountId, namespaceId, databaseId, token]) {
    if (!field)
      throw new Error(
        'Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN'
      );
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}`;
  const headers = { Authorization: `Bearer ${token}` };
  async function jsonRequest(path, body) {
    const response = await fetchImpl(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    // Do not log API bodies: query errors can contain passwords or user records.
    if (!response.ok)
      throw new Error(`Cloudflare request failed (HTTP ${response.status})`);
    const data = await response.json();
    if (
      !data.success ||
      data.result?.some?.((result) => result.success === false)
    ) {
      throw new Error('Cloudflare API returned an unsuccessful result');
    }
    return data;
  }
  const queryPath = `/d1/database/${encodeURIComponent(databaseId)}/query`;
  // Verify that schema setup has happened, including during the dry run.
  await jsonRequest(queryPath, {
    sql: 'SELECT username FROM users LIMIT 0; SELECT item_key FROM user_data LIMIT 0; SELECT key FROM settings LIMIT 0',
  });
  let cursor = '';
  let keys = 0;
  let rows = 0;
  let inserted = 0;
  do {
    const page = await jsonRequest(
      `/storage/kv/namespaces/${encodeURIComponent(
        namespaceId
      )}/keys?limit=1000${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      }`
    );
    for (const { name } of page.result) {
      if (name !== 'admin:config' && !/^u:.*:(pwd|pr|fav|sh|skip)$/.test(name))
        continue;
      const response = await fetchImpl(
        `${base}/storage/kv/namespaces/${encodeURIComponent(
          namespaceId
        )}/values/${encodeURIComponent(name)}`,
        {
          headers,
          signal: AbortSignal.timeout(60000),
        }
      );
      if (!response.ok)
        throw new Error(
          `KV read failed (HTTP ${response.status}); pause site writes and retry`
        );
      const statements = convertKVEntry(name, await response.text());
      keys++;
      rows += statements.length;
      if (write) {
        for (let offset = 0; offset < statements.length; offset += 25) {
          const result = await jsonRequest(queryPath, {
            batch: statements.slice(offset, offset + 25),
          });
          inserted += result.result.reduce(
            (sum, item) => sum + (item.meta?.changes ?? 0),
            0
          );
        }
      }
    }
    const nextCursor = page.result_info?.cursor || '';
    if (nextCursor && nextCursor === cursor)
      throw new Error('KV pagination did not advance');
    cursor = nextCursor;
  } while (cursor);
  return { mode: write ? 'write' : 'dry-run', keys, rows, inserted };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  migrate({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    write: process.argv.includes('--write'),
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
