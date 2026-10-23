import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const source = resolve(root, args.find(arg => !arg.startsWith('--')) || '../CrayonPlayer');
const target = resolve(root, 'packages', 'crayon-player');
if (!target.startsWith(root + sep)) throw new Error('Invalid player target');
const expected = new Map();
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Player sources cannot contain symlinks');
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
for (const folder of ['src', 'THIRD_PARTY_LICENSES']) {
  if (!existsSync(resolve(source, folder))) throw new Error(`Missing player ${folder}: ${source}`);
  for (const file of files(resolve(source, folder))) expected.set(relative(source, file), readFileSync(file));
}
for (const file of ['LICENSE', 'NOTICE.md', 'README.md']) expected.set(file, readFileSync(resolve(source, file)));
const manifest = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
expected.set('package.json', Buffer.from(JSON.stringify({ name: manifest.name, version: manifest.version, private: true, license: manifest.license, repository: manifest.repository }, null, 2) + '\n'));
const stale = ['src', 'THIRD_PARTY_LICENSES'].flatMap(folder => files(resolve(target, folder))).filter(path => !expected.has(relative(target, path)));
const changed = [...expected].filter(([file, data]) => !existsSync(resolve(target, file)) || !readFileSync(resolve(target, file)).equals(data));
if (check) {
  if (changed.length || stale.length) {
    console.error('Player package needs synchronization:', ...changed.map(([file]) => file), ...stale.map(file => relative(target, file)));
    process.exitCode = 1;
  } else console.log(`Crayon Player ${manifest.version}: ${expected.size} files match.`);
} else {
  for (const [file, data] of changed) {
    const path = resolve(target, file);
    if (!path.startsWith(target + sep)) throw new Error('Invalid player file path');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  for (const path of stale) {
    if (!path.startsWith(target + sep)) throw new Error('Invalid stale player path');
    unlinkSync(path);
  }
  console.log(`Synced Crayon Player ${manifest.version}: ${changed.length} updated, ${stale.length} stale files removed.`);
}
