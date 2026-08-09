# Cloudflare KV Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Cloudflare KV implementation of the existing storage interface and make the Worker select it through `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-kv`.

**Architecture:** Implement `CloudflareKVStorage` behind the existing `IStorage` interface. Use namespaced JSON keys for admin config and user-scoped records, retrieve the `LUNATV_KV` binding lazily from OpenNext context, and keep the existing Redis/Upstash/KVRocks adapters unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers KV, OpenNext Cloudflare context, Jest.

---

### Task 1: Lock the KV contract with tests

**Files:**

- Create: `src/lib/cloudflare-kv.db.test.ts`
- Modify: `src/lib/types.ts` only if a KV binding type requires a type-only helper

- [ ] **Step 1: Write failing tests** for admin config persistence, namespaced user records, missing values, and delete-user cleanup using an in-memory KV double implementing `get`, `put`, `delete`, and `list`.
- [ ] **Step 2: Run** `pnpm exec jest src/lib/cloudflare-kv.db.test.ts --runInBand` and confirm failure because `CloudflareKVStorage` does not exist.

### Task 2: Implement the adapter

**Files:**

- Create: `src/lib/cloudflare-kv.db.ts`

- [ ] **Step 1: Implement lazy binding lookup** with `getCloudflareContext({ async: false }).env.LUNATV_KV`, allowing a KV double to be passed to the constructor for tests.
- [ ] **Step 2: Implement all `IStorage` methods** using JSON values and stable key prefixes: `admin:config`, `user:<username>:pwd`, `user:<username>:users`, `user:<username>:history`, `user:<username>:favorites`, `user:<username>:skip:<source>:<id>`.
- [ ] **Step 3: Run** `pnpm exec jest src/lib/cloudflare-kv.db.test.ts --runInBand` and confirm all focused tests pass.

### Task 3: Select KV and declare the Worker binding

**Files:**

- Modify: `src/lib/db.ts`
- Modify: `wrangler.jsonc`

- [ ] \*\*Step 1: Add `cloudflare-kv` and `kv` to the storage type union and select `CloudflareKVStorage`.
- [ ] \*\*Step 2: Add the `LUNATV_KV` KV namespace binding declaration with the Cloudflare-created namespace ID.
- [ ] **Step 3: Run** `pnpm exec tsc --noEmit --incremental false` and confirm type checking passes.

### Task 4: Verify the full project

**Files:**

- No additional files.

- [ ] **Step 1: Run** `pnpm exec jest --runInBand`.
- [ ] **Step 2: Run** `git diff --check`.
- [ ] **Step 3: Record deployment prerequisites:** create a KV namespace named `lunatv`, bind it as `LUNATV_KV`, set `NEXT_PUBLIC_STORAGE_TYPE=cloudflare-kv`, deploy, and verify `/api/server-config` reports `cloudflare-kv`.
