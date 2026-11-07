#!/usr/bin/env bash
# Publishes the app to GitHub Pages at https://<owner>.github.io/hareem/
# The public repository holds the app's code only: customer data never leaves the phone.
# Usage: bash tools/publish.sh "what changed"   (bump VERSION in daftar/sw.js and daftar/js/app.js first)
set -euo pipefail

MESSAGE="${1:-Update app}"
OWNER="${2:-mahmoudyouns22}"
REPO="hareem"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"

if gh repo view "$OWNER/$REPO" > /dev/null 2>&1; then
  git clone -q "https://github.com/$OWNER/$REPO.git" "$WORK"
  rm -rf "$WORK/daftar" "$WORK/.github" "$WORK/tools"
  NEW_REPO=0
else
  git -C "$WORK" init -q -b main
  NEW_REPO=1
fi

mkdir -p "$WORK/tools"
cp -r "$ROOT/daftar" "$ROOT/.github" "$ROOT/README.md" "$WORK/"
cp "$ROOT/tools/e2e.cjs" "$ROOT/tools/make_icons.py" "$ROOT/tools/publish.sh" "$WORK/tools/"
printf 'node_modules/\n' > "$WORK/.gitignore"

cd "$WORK"
git config user.name "$OWNER"
git config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
git add -A
git commit -q -m "$MESSAGE" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

if [ "$NEW_REPO" = 1 ]; then
  gh repo create "$OWNER/$REPO" --public \
    --description "هريم: إيجار وتصليح وديون، يعمل من الهاتف بدون إنترنت" \
    --homepage "https://$OWNER.github.io/$REPO/"
  git remote add origin "https://github.com/$OWNER/$REPO.git"
  gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow > /dev/null
fi
git push -q -u origin main

echo
echo "Published. The link updates in about a minute:"
echo "https://$OWNER.github.io/$REPO/"
