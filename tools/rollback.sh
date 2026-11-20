#!/bin/sh
# Put an earlier production release back on Cloudflare, instantly, without rebuilding.
#
#   tools/rollback.sh              back to the release before the newest one
#   tools/rollback.sh release-3    back to that release
#
# Uses `wrangler rollback <version>`: Worker versions are immutable and include the static
# assets, so this restores the exact client and server that release shipped. Releases are
# listed in ../Syn3h-stable/releases.tsv (written by tools/release.sh).
#
# Frozen versions (?v=<version>) after a rollback: the Worker restored is the old one, with its
# own code and its own carried copies under /v/. A Worker without the FROZEN binding (every
# release before the R2 move) serves frozen versions from those carried copies only, so versions accepted after it
# 404 until production moves forward again; their files are safe in R2 (bucket syn3h-versions).
# A Worker with the FROZEN binding reads R2 first, then its carried copies, so every uploaded
# version keeps working. Once deployments stop carrying (step two of the R2 move, see
# tools/frozen-versions.mjs), R2 is the only place a frozen version is served from.
set -eu
cd "$(dirname "$0")/.."
. tools/cloudflare-token.sh
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
# Record what was done, for the next release and for people: when, from which live build, to which release.
FROM_ID="$(curl -sf --max-time 15 https://www.syn3h.com/build.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})' 2>/dev/null || true)"
printf '%s\t%s\t%s\t%s\n' "$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')" "${FROM_ID:-unknown}" "$REL" "$ID" >> ../Syn3h-stable/rollbacks.tsv 2>/dev/null || true
(cd "../Syn3h-stable/$ID" && with_cf_token node "$(cd "$OLDPWD" && pwd)/node_modules/wrangler/bin/wrangler.js" rollback "$VERSION" --message "rollback to $REL" --yes </dev/null)
# An HTTP 200 can still be the outgoing version at the edge for a few seconds. Wait for this
# release's exact entry bundle before the smoke, as release.sh does after a deploy.
tries=0
ASSETS_LOG="$(mktemp /tmp/syn3h-rollback-assets.XXXXXX)"
until node tools/check-public-build.mjs "$URL" "../Syn3h-stable/$ID" >>"$ASSETS_LOG" 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 30 ] || { cat "$ASSETS_LOG"; echo "Rollback deployed, but the public entry bundle did not match $REL's frozen build" >&2; exit 1; }
  sleep 2
done
tail -1 "$ASSETS_LOG"
echo "Smoke testing $URL ..."
# Preserve the check's exit status: grep also succeeds when it finds a FAIL line.
LOG="$(mktemp /tmp/syn3h-rollback-check.XXXXXX)"
SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-rollback.XXXXXX)" || { echo "Rollback deployed, but evidence directory allocation failed" >&2; exit 1; }
echo "Shot evidence: $SHOT_PARENT/evidence ($URL)"
if SYN3H_SHOT_EVIDENCE_DIR="$SHOT_PARENT/evidence" node tools/net-smoke.mjs "$URL" >"$LOG" 2>&1; then
  grep -E "^(FAIL|NET SMOKE)" "$LOG" || true
else
  cat "$LOG"
  echo "Rollback deployed, but verification failed. Full log: $LOG" >&2
  echo "A rolled-back build from before 16 November 2026 records no socket closes, so the smoke cannot tell a dropped connection from a game failure there and retries no step (see its NET SMOKE SUMMARY line)." >&2
  exit 1
fi
