#!/usr/bin/env bash
# Single place that writes the `gh-pages` branch (used by deploy.yml and preview-cleanup.yml).
#
# Layout of gh-pages:
#   .                      site built from `main`
#   previews/<slug>/       one folder per non-main branch (contains deploy.txt + optional meta.json)
#   previews/index.html    regenerated on every publish/cleanup: overview of
#                          all preview folders with links, PR info, commit and build time
#
# The branch is kept as ONE amended commit; pushes use --force-with-lease and are retried, so parallel runs
# (main deploy, branch previews, cleanup) never overwrite each other's changes.
#
# usage: gh-pages.sh slug <branch>        print the preview directory name of a branch
#        gh-pages.sh publish <dir> <src>  replace <dir> with the contents of <src> ("." = site root, keeps previews/)
#        gh-pages.sh cleanup [branch...]  remove the previews of the given branches and of all deleted branches
# env: GH_TOKEN, REPO, GITHUB_SHA (publish)
set -euo pipefail

PREVIEWS=previews

slug() { sed 's#[^A-Za-z0-9._-]#-#g' <<<"$1"; }
esc() {  # HTML-escape (PR titles and branch names come from users)
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' <<<"$1"
}

cmd="${1:-}"; shift || true
if [ "$cmd" = slug ]; then slug "$1"; exit 0; fi
case "$cmd" in publish|cleanup) ;; *) echo "usage: $0 slug|publish|cleanup …" >&2; exit 2;; esac

remote="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
git_() { git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' "$@"; }
if [ "$cmd" = publish ]; then src=$(cd "$2" && pwd); fi

write_index() {  # previews/index.html – reloads live previews from the current tree
  [ -d "$PREVIEWS" ] || return 0
  local rows="" sha="" meta="" branch="" pr="" title="" when="" prcell="" tmp="" r="" n
  for d in "$PREVIEWS"/*/; do
    [ -f "$d/deploy.txt" ] || continue
    n=${d#"$PREVIEWS"/}; n=${n%/}
    sha=$(tr -d '[:space:]' <"$d/deploy.txt")
    branch=""; pr=""; title=""; when=""
    if [ -f "$d/meta.json" ]; then
      meta=$(cat "$d/meta.json" 2>/dev/null || true)
      branch=$(jq -r '.branch // ""' <<<"$meta" 2>/dev/null || true)
      pr=$(jq -r '.pr // ""' <<<"$meta" 2>/dev/null || true)
      title=$(jq -r '.title // ""' <<<"$meta" 2>/dev/null || true)
      when=$(jq -r '.published // ""' <<<"$meta" 2>/dev/null || true)
    fi
    if [ -n "$pr" ] && [ "$pr" != "null" ]; then
      printf -v prcell '<td><a href="https://github.com/%s/pull/%s">#%s</a>' "$REPO" "$pr" "$pr"
      [ -n "$title" ] && printf -v tmp ' <span class="prtitle">%s</span>' "$(esc "$title")" || tmp=""
      prcell+="$tmp</td>"
    else
      prcell='<td>—</td>'
    fi
    printf -v r '<tr><td class="folder"><a href="%s/">%s/</a></td><td>%s</td>%s<td><code>%s</code></td><td>%s</td></tr>\n' \
      "$n" "$(esc "$n")" "$(esc "${branch:-—}")" "$prcell" "$(esc "${sha:0:7}")" "$(esc "${when:-—}")"
    rows+="$r"
  done
  local count=0
  if [ -n "$rows" ]; then count=$(grep -c '<tr' <<<"$rows" || true); fi
  [ -n "$rows" ] || rows="<tr><td colspan=\"5\">Derzeit keine Previews – baue einen Branch (push oder workflow_dispatch), um eine zu erzeugen.</td></tr>"
  cat > "$PREVIEWS/index.html" <<HTML
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Previews · ${REPO##*/}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 2rem 3vw; background: #0d1117; color: #c9d1d9; }
  h1 { font-size: 1.4rem; margin: 0 0 .3rem; }
  .meta { color: #8b949e; font-size: .9rem; margin-bottom: 1.5rem; }
  .meta a { color: #58a6ff; }
  table { border-collapse: collapse; width: 100%; }
  td { border-top: 1px solid #21262d; padding: .55rem .9rem .55rem 0; vertical-align: baseline; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: .1rem .4rem; font-size: .85em; }
  .prtitle { color: #8b949e; font-size: .95rem; }
  .folder a { font-family: ui-monospace, monospace; font-size: .95rem; }
  @media (max-width: 640px) { body { padding: 1rem 4vw; } td { padding-right: .4rem; } }
</style>
</head>
<body>
<h1>Previews</h1>
<p class="meta">$count Preview(s) live · Site (<a href="../">main</a>) · <a href="https://github.com/$REPO">GitHub</a> · Stand $(date -u +'%Y-%m-%d %H:%M UTC') · Übersicht wird bei jedem Build neu erzeugt</p>
<table>
<thead><tr><th>Ordner</th><th>Branch</th><th>PR</th><th>Commit</th><th>Gebaut (UTC)</th></tr></thead>
<tbody>
$rows</tbody>
</table>
</body>
</html>
HTML
}

apply() {  # runs inside the gh-pages checkout
  case "$cmd" in
    publish)
      local dir="$1"
      if [ "$dir" = . ]; then
        find . -mindepth 1 -maxdepth 1 ! -name .git ! -name "$PREVIEWS" -exec rm -rf {} +
      else
        rm -rf "$dir"; mkdir -p "$dir"
      fi
      cp -a "$src/." "$dir/"
      # marker so the online check can tell this deploy from a previous one
      echo "$GITHUB_SHA" > "$dir/deploy.txt"
      touch .nojekyll
      write_index
      ;;
    cleanup)
      local b live
      for b in "$@"; do rm -rf "$PREVIEWS/$(slug "$b")"; done
      live=$(git ls-remote --heads "$remote" | sed 's#.*refs/heads/##' | while read -r b; do slug "$b"; done)
      for d in "$PREVIEWS"/*/; do
        [ -d "$d" ] || continue
        grep -qxF "$(basename "$d")" <<<"$live" || { echo "removing orphaned $d"; rm -rf "$d"; }
      done
      write_index
      ;;
  esac
}

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/gh-pages.XXXXXX")
for attempt in $(seq 1 8); do
  rm -rf "$work"
  base=""
  if git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null; then
    git clone -q --depth 1 --branch gh-pages "$remote" "$work"
    base=$(git -C "$work" rev-parse HEAD)
  elif [ "$cmd" = cleanup ]; then
    echo "no gh-pages branch – nothing to clean up"; exit 0
  else
    mkdir -p "$work"; git -C "$work" init -q -b gh-pages
  fi

  (cd "$work" && apply "$@")
  git -C "$work" add -A
  if [ -n "$base" ] && git -C "$work" diff --cached --quiet; then echo "gh-pages unchanged"; exit 0; fi
  if [ "$cmd" = publish ]; then verb=Publish; else verb=Cleanup; fi
  msg="$verb ${GITHUB_SHA:-} $(date -u +%Y-%m-%dT%H:%MZ)"
  if [ -n "$base" ]; then git_ -C "$work" commit -q --amend -m "$msg"; else git_ -C "$work" commit -q -m "$msg"; fi

  # lease: only push if nobody else pushed since our clone (empty base = branch must not exist yet)
  if git -C "$work" push -q --force-with-lease="gh-pages:$base" "$remote" HEAD:gh-pages; then
    echo "gh-pages updated ($cmd, attempt $attempt)"; exit 0
  fi
  echo "gh-pages changed meanwhile – retrying ($attempt)"
  sleep $((attempt * 2 + RANDOM % 5))
done
echo "::error::could not update gh-pages after 8 attempts"
exit 1
