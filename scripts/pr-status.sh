#!/usr/bin/env bash
# Post or update a single status comment on the PR associated with the current branch.
#
# Usage:
#   pr-status.sh "<stage>"          # running a stage
#   pr-status.sh "" done            # finished successfully
#   pr-status.sh "" failed          # build failed
#   pr-status.sh "" cancelled       # build cancelled
#
# Env: GH_TOKEN, REPO, BRANCH, SHA, RUN_URL, URL (preview URL, optional)

set -uo pipefail

stage="${1:-}"
result="${2:-}"

PR=$(gh pr list --head "$BRANCH" --repo "$REPO" --state open --json number --jq '.[0].number' 2>/dev/null || true)
if [ -z "$PR" ] || [ "$PR" = "null" ]; then
  echo "no open PR for branch $BRANCH – skipping status comment"
  exit 0
fi

marker="<!-- pr-preview-status -->"

if [ -n "$result" ]; then
  case "$result" in
    done)      headline="✅ Preview ist live";;
    failed)    headline="❌ Preview-Build fehlgeschlagen";;
    cancelled) headline="⚠️ Preview-Build abgebrochen";;
    *)         headline="ℹ️ Preview-Status: $result";;
  esac
else
  headline="🔄 Preview wird gebaut…"
fi

body="$marker
$headline

"
if [ -n "$stage" ]; then
  body+="**Schritt:** $stage"$'\n\n'
fi
if [ -n "${URL:-}" ] && [ "$result" = "done" ]; then
  body+="**Preview:** $URL"$'\n\n'
fi
if [ -n "${SHA:-}" ]; then
  body+="**Commit:** \`${SHA:0:7}\`"$'\n'
fi
if [ -n "${RUN_URL:-}" ]; then
  body+="**Workflow-Run:** $RUN_URL"$'\n'
fi

# find existing comment
comment_id=$(gh api "repos/$REPO/issues/$PR/comments" --jq ".[] | select(.body | contains(\"$marker\")) | .id" 2>/dev/null | head -n1 || true)

if [ -n "$comment_id" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$comment_id" -f "body=$body" >/dev/null 2>&1 || echo "could not update comment $comment_id"
else
  printf '%s' "$body" > /tmp/pr-status-body.md
  gh pr comment "$PR" --repo "$REPO" --body-file /tmp/pr-status-body.md >/dev/null 2>&1 || echo "could not create comment"
fi

exit 0