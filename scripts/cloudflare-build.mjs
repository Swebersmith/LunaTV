import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Keep the compiled NEXT_PUBLIC_ value aligned with the deployed binding, even
// if an older Workers Builds environment variable still selects KV.
const parsed = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  readFileSync('wrangler.jsonc', 'utf8')
);
if (parsed.error) throw new Error('Invalid wrangler.jsonc');
const storageType = parsed.config.vars?.NEXT_PUBLIC_STORAGE_TYPE;
const adapterRoot = resolve('node_modules/@opennextjs/cloudflare');
const adapter = JSON.parse(
  readFileSync(resolve(adapterRoot, 'package.json'), 'utf8')
);
const cli = resolve(adapterRoot, adapter.bin['opennextjs-cloudflare']);
const result = spawnSync(
  process.execPath,
  [cli, 'build', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(storageType ? { NEXT_PUBLIC_STORAGE_TYPE: storageType } : {}),
    },
  }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
