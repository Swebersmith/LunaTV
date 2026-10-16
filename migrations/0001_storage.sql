-- Run once before selecting cloudflare-d1. No request-time schema writes.
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY NOT NULL,
  password TEXT NOT NULL
);

-- Separate rows prevent concurrent updates to different videos from overwriting
-- an entire user's collection. The primary key also indexes collection reads.
CREATE TABLE IF NOT EXISTS user_data (
  username TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('play', 'favorite', 'skip', 'search')),
  item_key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, kind, item_key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
