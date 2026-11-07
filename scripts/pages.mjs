// Shared by vite.config.js (dev server) and scripts/build.mjs (build).
// Every solo game gets its own page /<id>/ — the shell (index.html) with a <base> back to the root
// and <meta name="game">. The static hosts have no rewrites, so each game needs a real file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

// ids of the solo games, from the registry in manifest.js
export const gameIds = () =>
  [...readFileSync(resolve(ROOT, 'manifest.js'), 'utf8').matchAll(/\{ id: "([a-z0-9-]+)"/g)].map(m => m[1]);

export const gamePage = id =>
  readFileSync(resolve(ROOT, 'index.html'), 'utf8').replace(
    '<head>',
    `<head>\n<base href="../" />\n<meta name="game" content="${id}" />`,
  );
