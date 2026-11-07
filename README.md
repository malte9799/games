# games

Kleine Browser-Spiele (Single- und Multiplayer), statisch, ohne Backend.

- **Hub**: `/` (Mehrspieler-Lobby und Einzelspiel-Karten)
- **Spiel**: `/<id>/`, z. B. `/kniffel/`, `/2048/`. Jede Spiel-Seite wird beim Build erzeugt.
- **Spiele entwickeln / Doku**: [`docs/games.md`](docs/games.md)

## Entwicklung

```
pnpm install
pnpm dev        # http://localhost:5173 – Hub und /<id>/ direkt
pnpm build      # statische Seite in dist/ (scripts/build.mjs)
pnpm preview    # dist/ lokal anschauen
```

Die Seite ist reines HTML/JS ohne Bundler. `vite` ist nur für Dev-Server und Preview da.
Relative Pfade sind Absicht: Die Seite läuft unter `/games/` (GitHub Pages) und in Previews
(`/previews/<branch>/`), später auch auf einer eigenen Domain.

## Deploy

`main` → GitHub Pages (`gh-pages`), jeder andere Branch → Vorschau unter `previews/<branch>/`.
Ablauf und Aufräumen sind in `.github/workflows/` und `scripts/gh-pages.sh` beschrieben.
Vorher: Settings → Pages → Source „Deploy from a branch“ → `gh-pages` / `(root)`.

---

<details>
<summary>Vorlage: Ablage auf gh-pages (Template-Doku)</summary>

Ablage auf `gh-pages` (ein einzelner, immer wieder geamendeter Commit, `--force-with-lease` + Retry, damit parallele Runs sich nicht überbügeln):

```text
gh-pages/
├── index.html            Site (main)
├── previews/
│   ├── index.html        generierte Übersicht: Ordner | Branch | PR | Commit | gebaut
│   ├── feature-x/        Preview des Branches feature-x (deploy.txt + meta.json)
│   └── 123-fix-foo/      …
└── .nojekyll
```

## Anpassen

- **Build**: `deploy.yml` nutzt `pnpm install --frozen-lockfile && pnpm build` mit Node 22. Eigene App-Umgebung (Umgebungsvariablen fürs Build) im Kommentar-Beispiel in `deploy.yml` ergänzen.
- **Beispiel-Site** (`index.html`, `main.js`, `styles.css`, `vite.config.js`) einfach durch die eigene App ersetzen. `vite.config.js` mit `base: './'` beibehalten — die App liegt unter `/<repo>/`, nicht unter der Domain-Wurzel — sonst landen Assets im Preview unter der falschen URL.

## Dateien

| Pfad | Zweck |
|---|---|
| `.github/workflows/deploy.yml` | Deploy von `main` + Preview-Build für alle anderen Branches |
| `.github/workflows/pr-preview.yml` | PR-Kommentar, falls der Build vor PR-Eröffnung fertig war |
| `.github/workflows/preview-cleanup.yml` | Aufräumen bei PR-Close, Branch-Delete, wöchentlich, manuell |
| `scripts/gh-pages.sh` | Schreibt `gh-pages` (publish/cleanup) und generiert `previews/index.html` |
| `scripts/pr-status.sh` | Sticky-Statuskommentar pro PR |

</details>
