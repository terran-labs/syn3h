#!/bin/sh
# Ship a production release to Cloudflare from a frozen copy of a green, tagged milestone.
#
#   tools/release.sh <n> "note"             build, freeze, deploy, smoke test the public address
#   tools/release.sh <n> "note" --dry-run   the same, but serve the frozen copy with
#                                           `wrangler dev --local` instead of deploying, and also
#                                           smoke test it through a 150 ms latency proxy
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
set -eu
cd "$(dirname "$0")/.."
REPO="$(pwd)"
N="${1:-}"
NOTE="${2:-}"
MODE="${3:-}"
case "$N" in ''|*[!0-9]*) echo "usage: tools/release.sh <n> \"note\" [--dry-run]" >&2; exit 2 ;; esac
[ -n "$NOTE" ] || { echo "release.sh: give a note" >&2; exit 2; }
[ -z "$MODE" ] || [ "$MODE" = "--dry-run" ] || { echo "release.sh: unknown option $MODE" >&2; exit 2; }
DRY=""; [ "$MODE" = "--dry-run" ] && DRY=1

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
    fail "wrangler is not authenticated (npx wrangler login, or set CLOUDFLARE_API_TOKEN)"
  fi
fi

# --- Freeze ---------------------------------------------------------------------------------
echo "Freezing $MILESTONE ($COMMIT)..."
ID="$(tools/promote-stable.sh "release-$N: $NOTE" | tail -1)"
DEST="$(cd ../Syn3h-stable/"$ID" && pwd)"
printf '*.map\n' > "$DEST/dist/.assetsignore"
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
  if ! (cd "$DEST" && node "$WRANGLER" deploy --tag "release-$N" --message "$MILESTONE $COMMIT: $NOTE" </dev/null) >"$LOG-deploy.log" 2>&1; then
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
fi

# --- Smoke test -----------------------------------------------------------------------------
echo "Smoke testing $URL ..."
node tools/net-smoke.mjs "$URL" 2>&1 | tee "$LOG-smoke.log" | grep -E "^(FAIL|NET SMOKE)" || true
grep -q "^NET SMOKE OK" "$LOG-smoke.log" || fail "net-smoke failed against $URL (see $LOG-smoke.log)"

if [ -n "$DRY" ]; then
  npx tsx server/latency-proxy.ts --listen "$PROXY_PORT" --target "http://127.0.0.1:$PORT" --rtt 150 --jitter 30 >"$LOG-proxy.log" 2>&1 &
  PIDS="$PIDS $!"
  wait_http "http://127.0.0.1:$PROXY_PORT/" 30 || fail "latency proxy did not start"
  echo "Smoke testing through 150 ms round trip with 0 to 30 ms jitter each way..."
  node tools/net-smoke.mjs "http://127.0.0.1:$PROXY_PORT/" 2>&1 | tee "$LOG-smoke-latency.log" | grep -E "^(FAIL|NET SMOKE)" || true
  grep -q "^NET SMOKE OK" "$LOG-smoke-latency.log" || fail "net-smoke failed with latency (see $LOG-smoke-latency.log)"
  echo
  echo "DRY RUN OK: $MILESTONE ($COMMIT) frozen as $ID is deployable. Nothing was deployed or tagged."
  echo "Note: this repointed ../Syn3h-stable/current at $ID."
  exit 0
fi

# --- Record ---------------------------------------------------------------------------------
WHEN="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "release-$N" "$WHEN" "$URL" "$MILESTONE" "$COMMIT" "$VERSION" "$ID" >> ../Syn3h-stable/releases.tsv
git tag -a "release-$N" -m "release-$N: $NOTE ($URL, version $VERSION)"
echo
echo "RELEASE OK: release-$N is live at $URL"
echo "For ops/RELEASES.md:"
echo "- release-$N, $WHEN: $URL from $MILESTONE ($COMMIT), Worker version $VERSION, frozen copy $ID. $NOTE"
