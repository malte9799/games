// Builds the static site into dist/: the whole repo root (minus tooling) plus one page per solo game.
// Run with `pnpm build`. The result is served from the root of the host (GitHub Pages: /games/).
// Like Vite, the contents of public/ are served from the site root: public/avatar/x.webp -> /avatar/x.webp.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, gameIds, gamePage } from './pages.mjs';

const OUT = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const SKIP = new Set([
  '.git', '.github', '.gitignore', 'node_modules', 'dist', 'scripts', 'public', 'server',
  'package.json', 'pnpm-lock.yaml', 'vite.config.js', 'README.md', 'TODO.md', '.DS_Store',
]);
const noDsStore = s => !s.endsWith('.DS_Store');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const name of readdirSync(ROOT)) {
  if (SKIP.has(name)) continue;
  cpSync(join(ROOT, name), join(OUT, name), { recursive: true, filter: noDsStore });
}
if (existsSync(PUBLIC)) {
  for (const name of readdirSync(PUBLIC)) {
    if (name === '.DS_Store') continue;
    if (existsSync(join(OUT, name))) throw new Error(`public/${name} collides with a root entry of the same name`);
    cpSync(join(PUBLIC, name), join(OUT, name), { recursive: true, filter: noDsStore });
  }
}

for (const id of gameIds()) {
  const dir = join(OUT, id);
  if (existsSync(dir)) throw new Error(`game id "${id}" collides with an existing folder`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'index.html'), gamePage(id));
}
console.log(`built ${gameIds().length} game pages into dist/`);
