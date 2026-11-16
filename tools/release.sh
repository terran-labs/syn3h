#!/bin/sh
# Ship a production release to Cloudflare from a frozen copy of a green, tagged milestone.
#
#   tools/release.sh <n> "note"             build, freeze, deploy, smoke test the public address
#   tools/release.sh <n> "note" --dry-run   the same, but serve the frozen copy with
#                                           `wrangler dev --local` instead of deploying, and also
#                                           smoke test it through a 150 ms latency proxy
#   tools/release.sh <n> "note" --immediate reset every occupied room at once (see below)
#
# Run from the integration checkout with a clean tree whose HEAD carries a tag. Steps:
#  1. tools/promote-stable.sh freezes the build into ../Syn3h-stable/<id> (dist, server,
#     shared, src, wrangler.toml) and repoints ../Syn3h-stable/current at it, so the stable
#     channel and the release are the same build.
#  2. Source maps stay in the frozen copy (to read stack traces) but are not uploaded.
#  3. `wrangler deploy` runs from the frozen copy, never from the moving checkout.
#  4. tools/net-smoke.mjs runs against the public address; any failure exits non zero.
#  5. The release is recorded in ../Syn3h-stable/releases.tsv, the line for ops/RELEASES.md is
#     printed, and the local git tag release-<n> is created (not pushed).
# Roll back with tools/rollback.sh.
#
# --immediate. By default Cloudflare defers the new room code for a room with players in it:
# the room runs the old code for up to five minutes, then is reset and everyone in it
# reconnects (docs/CUTOVER.md, "Releasing while people are playing"). --immediate passes
# `--durable-objects-code-update-mode immediate` to the deploy, so every occupied room is
# reset now, at a moment you chose, not five minutes later. Players reconnect within a second
# and keep the world; scores and the round start again. Leave it off for a normal release
# made while nobody is playing.
set -eu
cd "$(dirname "$0")/.."
. tools/cloudflare-token.sh
# A release builds, runs wrangler and two Chromes: hold one machine-wide heavy slot throughout.
if [ -z "${SYN3H_RELEASE_SLOT:-}" ] && [ -x tools/heavy.sh ]; then
  SYN3H_RELEASE_SLOT=1 exec tools/heavy.sh env SYN3H_RELEASE_SLOT=1 "$(pwd)/tools/release.sh" "$@"
fi
REPO="$(pwd)"
N="${1:-}"
NOTE="${2:-}"
MODE="${3:-}"
case "$N" in ''|*[!0-9]*) echo "usage: tools/release.sh <n> \"note\" [--dry-run | --immediate]" >&2; exit 2 ;; esac
[ -n "$NOTE" ] || { echo "release.sh: give a note" >&2; exit 2; }
[ -z "$MODE" ] || [ "$MODE" = "--dry-run" ] || [ "$MODE" = "--immediate" ] || { echo "release.sh: unknown option $MODE" >&2; exit 2; }
DRY=""; [ "$MODE" = "--dry-run" ] && DRY=1
# Extra deploy arguments: empty for a normal release.
UPDATE_MODE=""; [ "$MODE" = "--immediate" ] && UPDATE_MODE="--durable-objects-code-update-mode immediate"

fail() { printf '\nRELEASE FAILED: %s\n' "$*" >&2; exit 1; }

# --- Preconditions --------------------------------------------------------------------------
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean"
if ! MILESTONE="$(git describe --exact-match --tags HEAD 2>/dev/null)"; then
  [ -n "$DRY" ] || fail "HEAD is not on a tag: tag a green milestone first"
  MILESTONE="untagged"
  echo "Warning: HEAD is not on a tag (allowed for a dry run only)."
fi
COMMIT="$(git rev-parse --short HEAD)"
if [ -z "$DRY" ] && git rev-parse -q --verify "refs/tags/release-$N" >/dev/null; then
  fail "tag release-$N already exists"
fi
WRANGLER="$REPO/node_modules/wrangler/bin/wrangler.js"
[ -f "$WRANGLER" ] || fail "wrangler is not installed in node_modules"
if [ -z "$DRY" ]; then
  if node "$WRANGLER" whoami 2>&1 | grep -qi "not authenticated"; then
    fail "wrangler is not authenticated (put the token in $SYN3H_CLOUDFLARE_TOKEN_FILE, set CLOUDFLARE_API_TOKEN, or npx wrangler login)"
  fi
fi

# Resolve the calendar label before building, so the UI and frozen metadata agree.
CALVER="$(node tools/release-notes.mjs next)" || fail "could not compute the calendar version"
export SYN3H_RELEASE_VERSION="$CALVER"
# Attempt records include rolled-back deployments. Draft against the last accepted
# production milestone, not the latest attempted release tag.
PREV="$(awk -F '\t' '$5 == "production" { previous = $2 } END { print previous }' release-notes/history.tsv)"

# --- Freeze ---------------------------------------------------------------------------------
echo "Freezing $MILESTONE ($COMMIT)..."
ID="$(tools/promote-stable.sh "release-$N: $NOTE" | tail -1)"
DEST="$(cd ../Syn3h-stable/"$ID" && pwd)"
printf '*.map\n' > "$DEST/dist/.assetsignore"
# Every deploy carries each earlier release, and this one, under dist/v/ so that
# https://www.syn3h.com/?v=<version> keeps serving it. A deploy without them breaks those links.
node tools/frozen-versions.mjs carry "$DEST" "$CALVER" || fail "could not carry the frozen versions into the build"
echo "Frozen copy: $DEST"
echo "Assets: $(find "$DEST/dist" -type f ! -name '*.map' ! -name .assetsignore | wc -l | tr -d ' ') files, $(du -sh "$DEST/dist" | cut -f1) with maps"

# Kill a process and all its descendants, by PID only.
killtree() {
  for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done
  kill "$1" 2>/dev/null || true
}
PIDS=""
cleanup() { for p in $PIDS; do killtree "$p"; done; }
trap cleanup EXIT INT TERM

# Wait for an HTTP server to answer, up to $2 seconds.
wait_http() {
  i=0
  until curl -sf -o /dev/null "$1"; do
    i=$((i + 1)); [ "$i" -le "$2" ] || return 1; sleep 1
  done
}

LOG="/tmp/syn3h-release-$N"
if [ -n "$DRY" ]; then
  # --- Dry run: the deploy checks, then the frozen copy served locally ----------------------
  echo "Checking the deploy bundle (wrangler deploy --dry-run)..."
  (cd "$DEST" && node "$WRANGLER" deploy --dry-run --outdir "$LOG-bundle") >"$LOG-check.log" 2>&1 \
    || { tail -30 "$LOG-check.log"; fail "wrangler deploy --dry-run"; }
  grep -iE "Total Upload|gzip|bindings|ROOMS|ASSETS" "$LOG-check.log" || true
  PORT="${RELEASE_DRY_PORT:-8795}"
  PROXY_PORT=$((PORT + 1))
  (cd "$DEST" && exec node "$WRANGLER" dev --local --port "$PORT" --ip 127.0.0.1) >"$LOG-dev.log" 2>&1 &
  PIDS="$PIDS $!"
  wait_http "http://127.0.0.1:$PORT/" 90 || { tail -30 "$LOG-dev.log"; fail "wrangler dev did not start"; }
  URL="http://127.0.0.1:$PORT/"
  echo "Serving the frozen copy at $URL"
else
  # --- Deploy ---------------------------------------------------------------------------------
  echo "Deploying from the frozen copy..."
  # Not interactive: if the account has no workers.dev subdomain yet, wrangler stops here with
  # a link to register one in the dashboard rather than choosing a public name for us.
  if ! (cd "$DEST" && node "$WRANGLER" deploy $UPDATE_MODE --tag "release-$N" --message "$MILESTONE $COMMIT: $NOTE" </dev/null) >"$LOG-deploy.log" 2>&1; then
    cat "$LOG-deploy.log"; fail "wrangler deploy (see $LOG-deploy.log)"
  fi
  cat "$LOG-deploy.log"
  grep -q "Current Version ID" "$LOG-deploy.log" || fail "wrangler deploy did not report a version (see $LOG-deploy.log)"
  URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$LOG-deploy.log" | head -1)/"
  VERSION="$(grep -oE 'Current Version ID: [0-9a-f-]+' "$LOG-deploy.log" | awk '{print $4}')"
  [ "$URL" != "/" ] || fail "no workers.dev address in the deploy output (see $LOG-deploy.log)"
  echo "Public address: $URL (version $VERSION)"
  # A new workers.dev name can take a moment to resolve.
  wait_http "$URL" 120 || fail "$URL did not answer within two minutes"
  # An HTTP 200 can still be an older edge deployment. Wait for this exact entry bundle
  # before gameplay acceptance, retaining every mismatch for rollout diagnostics.
  tries=0
  until node tools/check-public-build.mjs "$URL" "$DEST" >>"$LOG-assets.log" 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 30 ] || { cat "$LOG-assets.log"; fail "public entry bundle did not match frozen build"; }
    sleep 2
  done
  tail -1 "$LOG-assets.log"
fi

# --- Frozen versions ------------------------------------------------------------------------
# Each frozen release's page and every one of its files, as that page asks for them.
node tools/frozen-versions.mjs check "$URL" "$DEST" >"$LOG-frozen.log" 2>&1 \
  || { cat "$LOG-frozen.log"; fail "frozen version links are broken at $URL (see $LOG-frozen.log)"; }
tail -1 "$LOG-frozen.log"

# --- Smoke test -----------------------------------------------------------------------------
echo "Smoke testing $URL ..."
SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-normal.XXXXXX)" || fail "could not reserve smoke evidence directory"
echo "Shot evidence: $SHOT_PARENT/evidence ($URL)"
SYN3H_SHOT_EVIDENCE_DIR="$SHOT_PARENT/evidence" node tools/net-smoke.mjs "$URL" 2>&1 | tee "$LOG-smoke.log" | grep -E "^(FAIL|RETRY|NET SMOKE)" || true
grep -q "^NET SMOKE OK" "$LOG-smoke.log" || fail "net-smoke failed against $URL (see $LOG-smoke.log)"
# Steps passed, connection drops ridden through and step retries, for the release ledger.
SMOKE_SUMMARY="$(grep '^NET SMOKE SUMMARY ' "$LOG-smoke.log" | tail -1 | sed 's/^NET SMOKE SUMMARY //')"

if [ -n "$DRY" ]; then
  npx tsx server/latency-proxy.ts --listen "$PROXY_PORT" --target "http://127.0.0.1:$PORT" --rtt 150 --jitter 30 >"$LOG-proxy.log" 2>&1 &
  PIDS="$PIDS $!"
  wait_http "http://127.0.0.1:$PROXY_PORT/" 30 || fail "latency proxy did not start"
  echo "Smoke testing through 150 ms round trip with 0 to 30 ms jitter each way..."
  SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-latency.XXXXXX)" || fail "could not reserve latency evidence directory"
  echo "Shot evidence: $SHOT_PARENT/evidence (latency)"
  SYN3H_SHOT_EVIDENCE_DIR="$SHOT_PARENT/evidence" node tools/net-smoke.mjs "http://127.0.0.1:$PROXY_PORT/" 2>&1 | tee "$LOG-smoke-latency.log" | grep -E "^(FAIL|NET SMOKE)" || true
  grep -q "^NET SMOKE OK" "$LOG-smoke-latency.log" || fail "net-smoke failed with latency (see $LOG-smoke-latency.log)"
  echo
  echo "DRY RUN OK: $MILESTONE ($COMMIT) frozen as $ID is deployable. Nothing was deployed or tagged."
  echo "Note: this repointed ../Syn3h-stable/current at $ID."
  exit 0
fi

# --- Primary public acceptance ---------------------------------------------------------------
# A workers.dev pass does not establish that the owner-facing domain serves the same assets.
PRIMARY_URL="https://www.syn3h.com/"
tries=0
until node tools/check-public-build.mjs "$PRIMARY_URL" "$DEST" >>"$LOG-primary-assets.log" 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 30 ] || { cat "$LOG-primary-assets.log"; fail "primary entry bundle did not match frozen build"; }
  sleep 2
done
tail -1 "$LOG-primary-assets.log"
if ! tools/domain.sh check www.syn3h.com >"$LOG-primary.log" 2>&1; then
  cat "$LOG-primary.log"
node tools/frozen-versions.mjs check "$PRIMARY_URL" "$DEST" >"$LOG-primary-frozen.log" 2>&1 \
  || { cat "$LOG-primary-frozen.log"; fail "frozen version links are broken on the primary domain; roll back the deployment"; }
tail -1 "$LOG-primary-frozen.log"
  fail "primary domain acceptance failed; roll back the deployment"
fi
cat "$LOG-primary.log"
node tools/frozen-versions.mjs check "$PRIMARY_URL" "$DEST" >"$LOG-primary-frozen.log" 2>&1 \
  || { cat "$LOG-primary-frozen.log"; fail "frozen version links are broken on the primary domain; roll back the deployment"; }
tail -1 "$LOG-primary-frozen.log"

# --- Record ---------------------------------------------------------------------------------
WHEN="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "release-$N" "$WHEN" "$URL" "$MILESTONE" "$COMMIT" "$VERSION" "$ID" >> ../Syn3h-stable/releases.tsv
# Accepted: keep this release so every later deploy carries it. A failure here must be
# repaired before the next release, but does not undo a verified one.
node tools/frozen-versions.mjs archive "$DEST" "$CALVER" || echo "Warning: release is live but $CALVER was not archived; run tools/frozen-versions.mjs archive before the next release."
git tag -a "release-$N" -m "release-$N: $NOTE ($URL, version $VERSION)"
echo
echo "RELEASE OK: release-$N is live at $URL"
echo "For ops/RELEASES.md:"
echo "- release-$N, $WHEN: $URL from $MILESTONE ($COMMIT), Worker version $VERSION, frozen copy $ID. $NOTE. Public smoke: ${SMOKE_SUMMARY:-no summary}."

# These artifacts describe an already verified release. A capture or draft failure must
# never turn a successful deploy into a failed release or trigger rollback.
if ! (
  printf '%s\t%s\t%s\t%s\tproduction\n' "$CALVER" "$MILESTONE" "$COMMIT" "$WHEN" >> release-notes/history.tsv || exit 1
  git tag -a "$CALVER" -m "Syn3h $CALVER ($MILESTONE, release-$N)" || exit 1
  node tools/release-notes.mjs draft "$CALVER" "${PREV:-m00-proposal}" "release-$N"
); then
  echo "Warning: release is live; calendar tag or notes need repair. Inspect history before retrying."
fi
if ! node tools/showcase.mjs --dir "$DEST" --version "$CALVER" --headless >"$LOG-showcase.log" 2>&1; then
  echo "Warning: release is live; showcase capture failed. See $LOG-showcase.log."
else
  echo "Showcase ready at /tmp/syn3h-showcase/$CALVER. Review notes and images before publication."
fi

# Refresh aggregate dashboard tiles after the release record exists. The host supplies
# SYN3H_SESSION_STATE; never store its value in the repository or published dashboard.
if [ -f tools/dashboard-stats.mjs ]; then
  if ! node tools/dashboard-stats.mjs >"$LOG-dashboard-stats.log" 2>&1; then
    echo "Warning: release is live; dashboard statistics need refresh. See $LOG-dashboard-stats.log."
  fi
fi
