import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '..', 'CrayonPlayer');
const target = resolve(root, 'packages', 'crayon-player');
mkdirSync(target, { recursive: true });
cpSync(resolve(source, 'src'), resolve(target, 'src'), { recursive: true });
for (const file of ['LICENSE', 'NOTICE.md', 'README.md']) cpSync(resolve(source, file), resolve(target, file));
const manifest = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
writeFileSync(resolve(target, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, private: true, license: manifest.license, repository: manifest.repository }, null, 2) + '\n');
console.log(`Synced ${readdirSync(resolve(target, 'src')).length} player source files to packages/crayon-player`);
