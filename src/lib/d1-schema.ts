import type { CloudflareD1Binding, D1Statement } from './cloudflare-d1.db';

// Match migrations/0001_storage.sql. DDL runs only after a missing-table error,
// never on ordinary reads, cold starts, or an already initialized database.
export const D1_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY NOT NULL, password TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS user_data (
    username TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('play', 'favorite', 'skip', 'search')),
    item_key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (username, kind, item_key)
  )`,
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
];

const rawStatements = new WeakMap<D1Statement, D1Statement>();

export function withD1Schema(
  binding: CloudflareD1Binding
): CloudflareD1Binding {
  async function execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/no such table: (?:main\.)?(?:users|user_data|settings)\b/i.test(
          error.message
        )
      )
        throw error;
      // No in-flight promises or bindings are shared across request contexts.
      await binding.batch(D1_SCHEMA.map((sql) => binding.prepare(sql)));
      return operation();
    }
  }

  function wrap(raw: D1Statement): D1Statement {
    const statement: D1Statement = {
      bind: (...values) => wrap(raw.bind(...values)),
      first: <T>() => execute(() => raw.first<T>()),
      all: <T>() => execute(() => raw.all<T>()),
      run: () => execute(() => raw.run()),
    };
    rawStatements.set(statement, raw);
    return statement;
  }
  return {
    prepare: (sql) => wrap(binding.prepare(sql)),
    batch: (statements) =>
      execute(() =>
        binding.batch(
          statements.map(
            (statement) => rawStatements.get(statement) ?? statement
          )
        )
      ),
  };
}
