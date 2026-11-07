# GitHub-Pages-Preview-Template

Template für Projekte mit GitHub Pages + automatischen Previews:

- **`main`** → `https://<owner>.github.io/<repo>/`
- **jeder andere Branch** → `https://<owner>.github.io/<repo>/previews/<branch>/`
- **PR-Kommentar** mit Live-Status (Installieren → Build → Veröffentlichen → Online prüfen), ein Sticky-Comment pro PR
- **`previews/index.html`** – automatisch generierte Übersicht aller Live-Previews mit Links zu den Ordnern, Branch, PR, Commit und Build-Zeit
- **Aufräumen**: Preview wird beim PR-Close entfernt (auch wenn der Branch bleibt); verwaiste Previews wöchentlich und bei Branch-Delete

## Verwendung

1. **Use this template** → *Create a new repository*
2. Erster Deploy: Push auf `main` (oder „Run workflow" auf `deploy.yml`). Der Workflow richtet Pages automatisch ein — falls der erste Lauf die Einrichtung verpasst (frisches Repo): *Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / `(root)`*.
3. Das war's. Branch pushen / PR erstellen → es baut eine Preview und kommentiert.

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
