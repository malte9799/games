// Dev server only (`pnpm dev`). The build is scripts/build.mjs, which writes the same game pages.
import { gameIds, gamePage } from './scripts/pages.mjs';

const gamePagesDev = {
  name: 'game-pages-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/([a-z0-9-]+)\/?(?:\?.*)?$/i.exec(req.url ?? '');
      if (!m || !gameIds().includes(m[1])) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(gamePage(m[1]));
    });
  },
};

export default { base: './', plugins: [gamePagesDev] };
