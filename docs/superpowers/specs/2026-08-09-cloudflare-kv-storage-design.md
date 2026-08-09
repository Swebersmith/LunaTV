# Cloudflare KV Storage Design

## Goal

Replace the external Upstash dependency with a Cloudflare-native KV backend while preserving the existing `IStorage` contract and allowing the deployment to switch storage backends through `NEXT_PUBLIC_STORAGE_TYPE`.

## Architecture

Add a `CloudflareKVStorage` implementation of `IStorage`. It stores admin configuration as one JSON value and user-scoped records as individual JSON values under namespaced keys. The adapter obtains the `LUNATV_KV` binding lazily through OpenNext's `getCloudflareContext`, so importing the database module does not require a Cloudflare runtime during tests or static analysis.

The existing `DbManager` selects the adapter when `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-kv` (also accepting `kv` as an alias). No application route or component changes are required. `wrangler.jsonc` declares the `LUNATV_KV` binding and the ID of the dedicated `lunatv` namespace. The namespace ID is an identifier, not a secret.

## Consistency and failure behavior

KV reads are globally distributed and low latency. Writes are eventually consistent, which is acceptable for this app's admin configuration, playback history, favorites, and search history. Each write replaces one complete JSON value to avoid partial records. Missing values return the same empty/null results as the existing storage adapters. Binding or serialization failures are surfaced instead of silently falling back to in-memory state.

## Migration

The migration is opt-in through the storage type variable. Existing Upstash data remains untouched until a separate export/import is performed. The deployment should first create and bind a KV namespace, set `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-kv`, deploy, and then verify login, admin configuration, and cross-device reads.

## Verification

Unit tests cover key namespacing, JSON round trips, missing-value behavior, user deletion cleanup, and admin configuration persistence with an in-memory KV double. Type checking and the focused Jest suite must pass before deployment.
