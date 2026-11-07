#!/usr/bin/env bash
# Publishes the app to GitHub Pages at https://<owner>.github.io/hareem/
# Creates a public repository holding the app's code only: customer data never leaves the phone.
set -euo pipefail

OWNER="${1:-mahmoudyouns22}"
REPO="hareem"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"

mkdir -p "$WORK/tools"
cp -r "$ROOT/daftar" "$ROOT/.github" "$ROOT/README.md" "$WORK/"
cp "$ROOT/tools/e2e.cjs" "$ROOT/tools/make_icons.py" "$ROOT/tools/publish.sh" "$WORK/tools/"
printf 'node_modules/\n' > "$WORK/.gitignore"

cd "$WORK"
git init -q -b main
git config user.name "$OWNER"
git config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
git add -A
git commit -q -F - <<'MSG'
هريم 1.0.0: rental, repair and debt ledger for the shop

Phone-first offline app (PWA) in Arabic and Sorani Kurdish. All data stays
on the owner's phone; the optional backup goes to Google Drive through the
phone's share sheet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG

gh repo create "$OWNER/$REPO" --public \
  --description "هريم: إيجار وتصليح وديون، يعمل من الهاتف بدون إنترنت" \
  --homepage "https://$OWNER.github.io/$REPO/"
git remote add origin "https://github.com/$OWNER/$REPO.git"
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow > /dev/null
git push -q -u origin main

echo
echo "Published. The link goes live in about a minute:"
echo "https://$OWNER.github.io/$REPO/"
