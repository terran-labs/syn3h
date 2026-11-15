#!/bin/sh
# Put an earlier production release back on Cloudflare, instantly, without rebuilding.
#
#   tools/rollback.sh              back to the release before the newest one
#   tools/rollback.sh release-3    back to that release
#
# Uses `wrangler rollback <version>`: Worker versions are immutable and include the static
# assets, so this restores the exact client and server that release shipped. Releases are
# listed in ../Syn3h-stable/releases.tsv (written by tools/release.sh).
set -eu
cd "$(dirname "$0")/.."
LIST=../Syn3h-stable/releases.tsv
[ -f "$LIST" ] || { echo "rollback.sh: no releases recorded in $LIST" >&2; exit 1; }
if [ -n "${1:-}" ]; then
  LINE="$(awk -F'\t' -v r="$1" '$1 == r' "$LIST" | tail -1)"
else
  LINE="$(tail -2 "$LIST" | head -1)"
  [ "$(wc -l < "$LIST" | tr -d ' ')" -ge 2 ] || { echo "rollback.sh: only one release recorded; nothing earlier to return to" >&2; exit 1; }
fi
[ -n "$LINE" ] || { echo "rollback.sh: ${1:-previous release} not found in $LIST" >&2; exit 1; }
REL="$(printf '%s' "$LINE" | cut -f1)"
URL="$(printf '%s' "$LINE" | cut -f3)"
VERSION="$(printf '%s' "$LINE" | cut -f6)"
ID="$(printf '%s' "$LINE" | cut -f7)"
echo "Rolling back to $REL (Worker version $VERSION, frozen copy $ID)..."
(cd "../Syn3h-stable/$ID" && node "$(cd "$OLDPWD" && pwd)/node_modules/wrangler/bin/wrangler.js" rollback "$VERSION" --message "rollback to $REL" --yes </dev/null)
echo "Smoke testing $URL ..."
node tools/net-smoke.mjs "$URL" 2>&1 | grep -E "^(FAIL|NET SMOKE)"
