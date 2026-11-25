#!/bin/sh
# Ship a production release to Cloudflare from a frozen copy of a green, tagged milestone.
#
#   tools/release.sh <n> "note"             build, freeze, deploy, smoke test the public address
#   tools/release.sh <n> "note" --dry-run   the same, but serve the frozen copy with
#                                           `wrangler dev --local` instead of deploying, and also
#                                           smoke test it through a 150 ms latency proxy
#   tools/release.sh <n> "note" --immediate reset every occupied room at once (see below)
#   tools/release.sh <n> "note" --staging   freeze, deploy to the staging Worker and check it there;
#                                           production is not touched and nothing is recorded
#   tools/release.sh <n> "note" --beta      freeze, deploy the frozen copy UNEDITED to the staging
#                                           Worker, check it there and at https://beta.mira.cc/,
#                                           and record it in ../Syn3h-stable/betas.tsv. Production
#                                           is not touched and no production tag is made.
#   tools/release.sh <n> "note" --promote <frozen-id> --approved <version> --approval "<words>"
#                                           take the frozen copy a beta shipped, byte for byte, to
#                                           production: no build. Refuses unless <version> is the
#                                           version inside that copy; records the owner's approving
#                                           words beside it in ../Syn3h-stable/approvals.tsv.
#
# Beta first, production only on the owner's approval in their own words (ops/RELEASE.md, 25
# November 2026). A plain production release (no option) builds a new copy and deploys it straight
# to production: it is refused unless MIRA_DIRECT_RELEASE=1 names a reason the Foreman gave.
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
# Once the deploy has started, any failure before the release is accepted (a failed check on
# either address, an error that stops the script, Ctrl-C or a kill) rolls back to the release
# that was live before, verifies both public addresses serve it, and says so. To roll back by
# hand later, use tools/rollback.sh.
#
# MIRA_RELEASE_STUB=1 proves that path without touching Cloudflare: the deploy and the
# rollback are printed instead of run, the frozen copy is served locally as in a dry run, and
# the run fails before the record step. MIRA_RELEASE_FORCE_FAIL=smoke fails the smoke step
# without running it. The rollback's verification of the live addresses is real (read only).
#
# --immediate. By default Cloudflare defers the new room code for a room with players in it:
# the room runs the old code for up to five minutes, then is reset and everyone in it
# reconnects (docs/CUTOVER.md, "Releasing while people are playing"). --immediate passes
# `--durable-objects-code-update-mode immediate` to the deploy, so every occupied room is
# reset now, at a moment you chose, not five minutes later. Players reconnect within a second
# and keep the world; scores and the round start again. Leave it off for a normal release
# made while nobody is playing.
. "$(dirname "$0")/lib/legacy-env.sh" # legacy environment names, see docs/NAMES.md
set -eu
cd "$(dirname "$0")/.."
. tools/cloudflare-token.sh
. tools/smoke-run.sh
# A release builds, runs wrangler and two Chromes: hold one machine-wide heavy slot throughout.
# It also holds the machine until it exits: the hold names this PID, which exec keeps through
# heavy.sh, so the hold lifts by itself when the release ends or dies, and says 'running', so
# heavy.py lets one other job share a slot beside it (tools/heavy.py; tools/ship.sh holds it
# fully, 'gate', while it waits for the load to fall before starting this).
if [ -z "${MIRA_RELEASE_SLOT:-}" ] && [ -x tools/heavy.sh ]; then
  _hold_root="${MIRA_HEAVY_ROOT:-/tmp/syn3h-heavy-v2}"; mkdir -p "$_hold_root" && printf '%s\nrunning\n' "$$" >"$_hold_root/hold"
  MIRA_HEAVY_RELEASE=1 MIRA_RELEASE_SLOT=1 exec tools/heavy.sh env MIRA_RELEASE_SLOT=1 "$(pwd)/tools/release.sh" "$@"
fi
REPO="$(pwd)"
N="${1:-}"
NOTE="${2:-}"
MODE="${3:-}"
case "$N" in ''|*[!0-9]*) echo "usage: tools/release.sh <n> \"note\" [--dry-run | --immediate | --staging | --beta | --promote <frozen-id> --approved <version> --approval \"<words>\"]" >&2; exit 2 ;; esac
[ -n "$NOTE" ] || { echo "release.sh: give a note" >&2; exit 2; }
case "$MODE" in ''|--dry-run|--immediate|--staging|--beta|--promote) ;; *) echo "release.sh: unknown option $MODE" >&2; exit 2 ;; esac
DRY=""; [ "$MODE" = "--dry-run" ] && DRY=1
STAGE_ONLY=""; [ "$MODE" = "--staging" ] && STAGE_ONLY=1
BETA=""; [ "$MODE" = "--beta" ] && BETA=1
PROMOTE=""; PROMOTE_ID=""; APPROVED=""; APPROVAL=""
if [ "$MODE" = "--promote" ]; then
  PROMOTE=1; PROMOTE_ID="${4:-}"
  shift 4 2>/dev/null || { echo "release.sh: --promote needs <frozen-id> --approved <version> --approval \"<words>\"" >&2; exit 2; }
  while [ $# -gt 0 ]; do
    case "$1" in
      --approved) APPROVED="${2:-}"; shift 2 ;;
      --approval) APPROVAL="${2:-}"; shift 2 ;;
      *) echo "release.sh: unknown argument $1 after --promote" >&2; exit 2 ;;
    esac
  done
  case "$PROMOTE_ID" in ''|*/*|.*) echo "release.sh: --promote needs a frozen id from ../Syn3h-stable (a directory name)" >&2; exit 2 ;; esac
  [ -n "$APPROVED" ] || { echo "release.sh: --promote refuses without --approved <version>: the version the owner approved" >&2; exit 2; }
  [ -n "$APPROVAL" ] || { echo "release.sh: --promote refuses without --approval \"<the owner's approving words>\"" >&2; exit 2; }
fi
# Beta first, production only on the owner's approval: a plain release builds and ships straight
# to production, so it needs an explicit reason (a recorded exception from the Foreman).
if [ -z "$MODE" ] || [ "$MODE" = "--immediate" ]; then
  [ -n "${MIRA_DIRECT_RELEASE:-}" ] || { echo "release.sh: production releases go through --beta, then --promote with the owner's approval (ops/RELEASE.md). Set MIRA_DIRECT_RELEASE=<reason> only on the Foreman's explicit word." >&2; exit 2; }
fi
STUB="${MIRA_RELEASE_STUB:-}"; [ -z "$DRY" ] || STUB=""
# Extra deploy arguments: empty for a normal release.
UPDATE_MODE=""; [ "$MODE" = "--immediate" ] && UPDATE_MODE="--durable-objects-code-update-mode immediate"

fail() { printf '\nRELEASE FAILED: %s\n' "$*" >&2; exit 1; }

# --- Preconditions --------------------------------------------------------------------------
[ -z "$(git status --porcelain)" ] || fail "the working tree is not clean"
if [ -n "$PROMOTE" ]; then
  # Promote: the build, its commit and its version all come from the frozen copy the beta
  # shipped, never from HEAD or today's date.
  DEST="$(cd ../Syn3h-stable/"$PROMOTE_ID" 2>/dev/null && pwd)" || fail "no frozen copy ../Syn3h-stable/$PROMOTE_ID"
  [ -f "$DEST/dist/build.json" ] || fail "$DEST has no dist/build.json"
  _bj() { node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b[process.argv[2]]??""))' "$DEST/dist/build.json" "$1"; }
  [ "$(_bj id)" = "$PROMOTE_ID" ] || fail "$DEST/dist/build.json names $(_bj id), not $PROMOTE_ID"
  COMMIT_FULL="$(_bj commit)"; COMMIT="$(git rev-parse --short "$COMMIT_FULL" 2>/dev/null)" || fail "commit $COMMIT_FULL of $PROMOTE_ID is not in this repository"
  awk -F '\t' -v id="$PROMOTE_ID" '$3 == id { found = 1 } END { exit !found }' ../Syn3h-stable/betas.tsv 2>/dev/null \
    || fail "$PROMOTE_ID was never shipped as a beta (no line in ../Syn3h-stable/betas.tsv): only what the owner tested on beta can be promoted"
  MILESTONE="$(git describe --exact-match --tags "$COMMIT_FULL" 2>/dev/null | grep -v '^v[0-9]' | grep -v '^release-' | head -1)"
  [ -n "$MILESTONE" ] || MILESTONE="$(awk -F '\t' -v id="$PROMOTE_ID" '$3 == id { m = $4 } END { print m }' ../Syn3h-stable/betas.tsv)"
else
  if ! MILESTONE="$(git describe --exact-match --tags HEAD 2>/dev/null)"; then
    [ -n "$DRY" ] || fail "HEAD is not on a tag: tag a green milestone first"
    MILESTONE="untagged"
    echo "Warning: HEAD is not on a tag (allowed for a dry run only)."
  fi
  COMMIT="$(git rev-parse --short HEAD)"; COMMIT_FULL="$(git rev-parse HEAD)"
fi
# The version this release ships as, first: it is named by the Pacific date, so a train
# prepared before midnight ships with the next day's number. Resolved before building, so the
# UI and frozen metadata agree; the dry run, staging and the release all check it here.
if [ -n "$PROMOTE" ]; then
  # The version was fixed when the beta was built and is promoted unchanged, on any later day.
  CALVER="$(_bj version)"; [ -n "$CALVER" ] || fail "$PROMOTE_ID records no version"
  [ "$APPROVED" = "$CALVER" ] || fail "the approval names $APPROVED, but $PROMOTE_ID is $CALVER: nothing promoted"
else
  CALVER="$(node tools/release-notes.mjs next)" || fail "could not compute the calendar version"
fi
export MIRA_RELEASE_VERSION="$CALVER"
echo "Version: $CALVER"
# The notes are published after the release is live, so check now, before anything is built,
# that the publish tool will accept them: their name, heading, every version-bearing link and
# the player digest name $CALVER (on 22 November a renamed file still said the day before), and
# every required section is there. release-notes.mjs check names the fix when they do not.
node tools/release-notes.mjs check "$CALVER" || fail "the release notes are not for $CALVER (see above); nothing was built"
NOTES="release-notes/releases/$CALVER.md"
for _section in Features Fixes Handling Play Performance "Known issues"; do
  grep -q "^### $_section\$" "$NOTES" || fail "$NOTES has no '### $_section' section"
done
if [ -z "$DRY" ] && git rev-parse -q --verify "refs/tags/release-$N" >/dev/null; then
  fail "tag release-$N already exists"
fi
WRANGLER="$REPO/node_modules/wrangler/bin/wrangler.js"
[ -f "$WRANGLER" ] || fail "wrangler is not installed in node_modules"
if [ -z "$DRY" ]; then
  if with_cf_token node "$WRANGLER" whoami 2>&1 | grep -qi "not authenticated"; then
    fail "wrangler is not authenticated (put the token in $MIRA_CLOUDFLARE_TOKEN_FILE, set CLOUDFLARE_API_TOKEN, or npx wrangler login)"
  fi
fi
# Every earlier release must be whole in R2 before anything is built: deploys no longer carry
# them, so the Worker serves them from R2 alone. A version without a verified row in
# ../Syn3h-stable/r2-verified.tsv is uploaded and verified here; if that fails, the release stops
# with nothing frozen, deployed or recorded. (A local dry run has no R2 to serve from: skipped.)
if [ -z "$DRY" ] && [ -z "$STUB" ]; then
  with_cf_token node tools/frozen-versions.mjs r2-preflight >"/tmp/syn3h-release-$N-r2-preflight.log" 2>&1 \
    || { cat "/tmp/syn3h-release-$N-r2-preflight.log"; fail "earlier releases are not all verified in R2; nothing was built or deployed"; }
  tail -1 "/tmp/syn3h-release-$N-r2-preflight.log"
fi

# Attempt records include rolled-back deployments. Draft against the last accepted
# production milestone, not the latest attempted release tag.
PREV="$(awk -F '\t' '$5 == "production" { previous = $2 } END { print previous }' release-notes/history.tsv)"

# The release live now, to return to if this one is not accepted, and the stable pointer's
# target, to restore with it.
# The release live now is the one mira.cc serves, not necessarily the last row of
# releases.tsv: a hand rollback (tools/rollback.sh) leaves production on an older release.
LIVE_ID="$(curl -sf --max-time 15 https://mira.cc/build.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})' 2>/dev/null || true)"
PREV_LINE="$(awk -F '\t' -v id="$LIVE_ID" 'id != "" && $7 == id' ../Syn3h-stable/releases.tsv 2>/dev/null | tail -1)"
if [ -z "$PREV_LINE" ]; then
  PREV_LINE="$(tail -1 ../Syn3h-stable/releases.tsv 2>/dev/null || true)"
  [ -n "$DRY" ] || echo "Warning: could not match the live build (${LIVE_ID:-unreadable}) in releases.tsv; a rollback would return to its last row."
fi
PREV_REL="$(printf '%s' "$PREV_LINE" | cut -f1)"
PREV_ID="$(printf '%s' "$PREV_LINE" | cut -f7)"
PREV_CURRENT="$(readlink ../Syn3h-stable/current 2>/dev/null || true)"
[ -n "$DRY" ] || [ -n "$PREV_REL" ] || fail "no earlier release in ../Syn3h-stable/releases.tsv to roll back to"
if [ -n "$PROMOTE" ]; then
  # The beta's frozen build lists every version production had when it was built. If production
  # has moved on since, promoting it would drop a version from ?v=: build a new beta instead.
  LIVE_VER="$(curl -sf --max-time 15 https://mira.cc/build.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).version||"")}catch{}})' 2>/dev/null || true)"
  [ -n "$LIVE_VER" ] || fail "could not read the live version from https://mira.cc/build.json"
  node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].replace(/^v/,"");process.exit((l.versions||l).includes(v)?0:1)' "$DEST/dist/v/versions.json" "$LIVE_VER" \
    || fail "production is on $LIVE_VER, which $PROMOTE_ID does not know: production moved on after this beta was built. Ship a new beta."
fi

# --- Freeze ---------------------------------------------------------------------------------
if [ -n "$PROMOTE" ]; then
  # No build: the beta's frozen copy, its versions list and its .assetsignore as they were shipped.
  ID="$PROMOTE_ID"
  ln -sfn "$ID" ../Syn3h-stable/current
  echo "Promoting the frozen copy $ID ($CALVER, $MILESTONE $COMMIT) unchanged; approved as \"$APPROVAL\""
else
echo "Freezing $MILESTONE ($COMMIT)..."
ID="$(tools/promote-stable.sh "release-$N: $NOTE" | tail -1)"
DEST="$(cd ../Syn3h-stable/"$ID" && pwd)"
printf '*.map\n' > "$DEST/dist/.assetsignore"
# Frozen versions (https://mira.cc/?v=<version>): the Worker serves this release's own
# version from this build and every earlier one from R2 (bucket syn3h-versions, checked by the
# preflight above). The build carries no old versions, only dist/v/versions.json listing them
# all, and `prepare` refuses a build that changes a root file an earlier version also serves.
# After a rollback, frozen versions are served by the restored Worker: see tools/rollback.sh.
node tools/frozen-versions.mjs prepare "$DEST" "$CALVER" || fail "could not prepare the frozen versions list"
fi
echo "Frozen copy: $DEST"
echo "Assets: $(find "$DEST/dist" -type f ! -name '*.map' ! -name .assetsignore | wc -l | tr -d ' ') files, $(du -sh "$DEST/dist" | cut -f1) with maps"

# Kill a process and all its descendants, by PID only.
killtree() {
  for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done
  kill "$1" 2>/dev/null || true
}
PIDS=""
cleanup() { for p in $PIDS; do killtree "$p"; done; }

# Wait until an address serves a frozen build everywhere we can see: Cloudflare's edges switch
# versions over minutes, and a page can get one build's HTML and the other's missing files.
# settle <url> <frozen dir> <log> [--feed]: five passes in a row about 6 s apart (any failure
# starts the count again), giving up after three minutes.
settle() {
  _ok=0; _start=$(date +%s)
  while [ "$_ok" -lt 5 ]; do
    if node tools/check-public-build.mjs "$1" "$2" ${4:-} >>"$3" 2>&1; then _ok=$((_ok + 1)); else _ok=0; fi
    [ $(( $(date +%s) - _start )) -lt 180 ] || return 1
    [ "$_ok" -ge 5 ] || sleep 6
  done
}

# Set from the moment the deploy starts until the release is accepted. Leaving the script
# while it is set, for any reason, rolls back.
DEPLOYED=""
roll_back() {
  trap '' INT TERM
  printf '\nROLLING BACK: release-%s was not accepted; returning production to %s (frozen copy %s)...\n' "$N" "$PREV_REL" "$PREV_ID" >&2
  _rlog="/tmp/syn3h-release-$N-rollback-check.log"; : >"$_rlog"
  if [ -n "$STUB" ]; then
    echo "STUB: tools/rollback.sh $PREV_REL" >&2
  elif ! tools/rollback.sh "$PREV_REL" >&2; then
    # rollback.sh fails on its own smoke too, and a smoke right after the switch can load a
    # page from an edge still serving the other build. Settle, then smoke once more.
    echo "rollback.sh did not verify; waiting for the edges to settle and smoking once more..." >&2
    if ! settle https://syn3h.af-4e7.workers.dev/ "../Syn3h-stable/$PREV_ID" "$_rlog" \
      || ! node tools/net-smoke.mjs https://syn3h.af-4e7.workers.dev/ >"$_rlog-smoke" 2>&1; then
      tail -5 "$_rlog" "$_rlog-smoke" >&2 2>/dev/null
      printf '\nROLLBACK FAILED: production may still serve release-%s. Run tools/rollback.sh %s now.\n' "$N" "$PREV_REL" >&2; return 1
    fi
    grep '^NET SMOKE SUMMARY' "$_rlog-smoke" >&2 || true
  fi
  # Verify both addresses, the owner-facing domain included: rollback.sh checks workers.dev only.
  for url in https://syn3h.af-4e7.workers.dev/ https://mira.cc/; do
    settle "$url" "../Syn3h-stable/$PREV_ID" "$_rlog" || { tail -5 "$_rlog" >&2; printf '\nROLLBACK FAILED: %s does not serve %s. Run tools/rollback.sh %s now.\n' "$url" "$PREV_REL" "$PREV_REL" >&2; return 1; }
    printf 'Verified %s (5 passes in a row): %s\n' "$url" "$(tail -1 "$_rlog")" >&2
  done
  [ -z "$PREV_CURRENT" ] || ln -sfn "$PREV_CURRENT" ../Syn3h-stable/current
  printf '\nROLLED BACK: production serves %s again, verified on workers.dev and mira.cc. release-%s was not recorded or tagged.\n' "$PREV_REL" "$N" >&2
}
on_exit() {
  status=$?
  trap - EXIT
  cleanup
  # The staging clone is only needed while staging is checked; its logs stay in /tmp.
  [ -z "${STAGING_DEST:-}" ] || rm -rf "$STAGING_DEST"
  if [ -n "$DEPLOYED" ]; then roll_back || true; [ "$status" -ne 0 ] || status=1; fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
  (cd "$DEST" && with_cf_token node "$WRANGLER" deploy --dry-run --outdir "$LOG-bundle") >"$LOG-check.log" 2>&1 \
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
  # --- Staging --------------------------------------------------------------------------------
  # The same frozen build on the staging Worker first (wrangler.staging.toml: its own name, its
  # own rooms, no routes), checked on Cloudflare's real network before production is touched.
  # A failure here stops the release with production unchanged: nothing to roll back.
  # Promote skips this: the same bytes were deployed and checked here when they shipped as a beta.
  if [ -z "$PROMOTE" ]; then
  STAGING_DEST="$DEST.staging"
  rm -rf "$STAGING_DEST"; cp -Rc "$DEST" "$STAGING_DEST" 2>/dev/null || cp -R "$DEST" "$STAGING_DEST"
  if [ -z "$BETA" ]; then
    # --staging only: mark the page so a stray visitor cannot take staging for the real game.
    # A beta is deployed unedited: the bytes the owner tests are the bytes that ship, and the
    # Worker tells beta from production by hostname (robots, noindex, the beta mark).
    printf 'User-agent: *\nDisallow: /\n' > "$STAGING_DEST/dist/robots.txt"
    sed -i '' 's#<title>#<title>[staging] #' "$STAGING_DEST/dist/index.html"
  fi
  echo "Deploying to staging${BETA:+ (beta, unedited)}..."
  if [ -n "$STUB" ]; then
    echo "STUB: (cd $STAGING_DEST && wrangler deploy --config wrangler.staging.toml --message \"$MILESTONE $COMMIT: $NOTE\")"
  else
    (cd "$STAGING_DEST" && with_cf_token node "$WRANGLER" deploy --config wrangler.staging.toml --message "$MILESTONE $COMMIT: $NOTE" </dev/null) >"$LOG-staging-deploy.log" 2>&1 \
      || { cat "$LOG-staging-deploy.log"; fail "staging deploy failed (production untouched)"; }
    STAGING_URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$LOG-staging-deploy.log" | head -1)/"
    [ "$STAGING_URL" != "/" ] || fail "no staging address in the deploy output (production untouched)"
    echo "Staging address: $STAGING_URL"
    settle "$STAGING_URL" "$STAGING_DEST" "$LOG-staging-assets.log" --feed || { tail -20 "$LOG-staging-assets.log"; fail "staging did not settle on the frozen build (production untouched)"; }
    tail -1 "$LOG-staging-assets.log"
    node tools/frozen-versions.mjs check "$STAGING_URL" "$STAGING_DEST" >"$LOG-staging-frozen.log" 2>&1 \
      || { cat "$LOG-staging-frozen.log"; fail "frozen version links are broken on staging (production untouched)"; }
    tail -2 "$LOG-staging-frozen.log"
    SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-staging.XXXXXX)" || fail "could not reserve staging evidence directory"
    echo "Smoke testing staging, with shot evidence in $SHOT_PARENT/evidence ..."
    # Staging has its own crash budget, larger than production's: a crash is the machine, not
    # the game, so it is a rerun, up to four; a game failure stops the release at once.
    _prod_crashes="${MIRA_CRASH_COUNT:-}"; MIRA_CRASH_COUNT="$(mktemp /tmp/syn3h-crash-count-staging.XXXXXX)"; MIRA_CRASH_CAP=4
    _staging_ok=1; run_smoke "$STAGING_URL" "$LOG-staging-smoke.log" "$SHOT_PARENT/evidence" || _staging_ok=""
    MIRA_CRASH_CAP=2; if [ -n "$_prod_crashes" ]; then MIRA_CRASH_COUNT="$_prod_crashes"; else unset MIRA_CRASH_COUNT; fi
    [ -n "$_staging_ok" ] || fail "net-smoke failed on staging (production untouched; see $LOG-staging-smoke.log)"
  fi
  if [ -n "$BETA" ]; then
    # The owner tests at https://beta.mira.cc/ (the staging Worker's Custom Domain): it must serve
    # this exact build too, with its certificate, its socket and the short public check.
    BETA_URL="https://beta.mira.cc/"
    if [ -z "$STUB" ]; then
      settle "$BETA_URL" "$STAGING_DEST" "$LOG-beta-assets.log" --feed || { tail -20 "$LOG-beta-assets.log"; fail "beta.mira.cc did not settle on the frozen build (production untouched)"; }
      tail -1 "$LOG-beta-assets.log"
      MIRA_SHORT_CHECK=1 MIRA_DOMAIN_WORKER=syn3h-staging tools/domain.sh check beta.mira.cc --zone mira.cc >"$LOG-beta.log" 2>&1 \
        || { cat "$LOG-beta.log"; fail "beta.mira.cc acceptance failed (production untouched)"; }
      cat "$LOG-beta.log"
    fi
    BWHEN="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')"
    [ -n "$STUB" ] || printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$CALVER" "$BWHEN" "$ID" "$MILESTONE" "$COMMIT" "beta-for-release-$N" "$NOTE" >> ../Syn3h-stable/betas.tsv
    echo
    echo "BETA OK: $CALVER ($MILESTONE $COMMIT), frozen as $ID, is live at $BETA_URL. Production was not touched."
    echo "Promote only on the owner's approval of $CALVER in their own words:"
    echo "  tools/release.sh <n> \"$NOTE\" --promote $ID --approved $CALVER --approval \"<their words>\""
    exit 0
  fi
  fi
  if [ -n "$STAGE_ONLY" ]; then
    echo
    echo "STAGING OK: $MILESTONE ($COMMIT) frozen as $ID passed on the staging Worker. Production was not touched; nothing was recorded or tagged."
    echo "Note: this repointed ../Syn3h-stable/current at $ID."
    exit 0
  fi
  # --- Deploy ---------------------------------------------------------------------------------
  echo "Deploying from the frozen copy..."
  # From here until the release is accepted, leaving the script rolls back (on_exit).
  DEPLOYED=1
  if [ -n "$STUB" ]; then
    # Prove the failure path without Cloudflare: print the deploy, serve the frozen copy here.
    echo "STUB: (cd $DEST && wrangler deploy $UPDATE_MODE --tag release-$N --message \"$MILESTONE $COMMIT: $NOTE\")"
    PORT="${RELEASE_DRY_PORT:-8795}"
    (cd "$DEST" && exec node "$WRANGLER" dev --local --port "$PORT" --ip 127.0.0.1) >"$LOG-dev.log" 2>&1 &
    PIDS="$PIDS $!"
    printf 'https://stub.invalid.workers.dev\nCurrent Version ID: stub\n' >"$LOG-deploy.log"
  fi
  # Not interactive: if the account has no workers.dev subdomain yet, wrangler stops here with
  # a link to register one in the dashboard rather than choosing a public name for us.
  if [ -z "$STUB" ] && ! (cd "$DEST" && with_cf_token node "$WRANGLER" deploy $UPDATE_MODE --tag "release-$N" --message "$MILESTONE $COMMIT: $NOTE" </dev/null) >"$LOG-deploy.log" 2>&1; then
    cat "$LOG-deploy.log"; fail "wrangler deploy (see $LOG-deploy.log)"
  fi
  cat "$LOG-deploy.log"
  grep -q "Current Version ID" "$LOG-deploy.log" || fail "wrangler deploy did not report a version (see $LOG-deploy.log)"
  URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$LOG-deploy.log" | head -1)/"
  VERSION="$(grep -oE 'Current Version ID: [0-9a-f-]+' "$LOG-deploy.log" | awk '{print $4}')"
  [ "$URL" != "/" ] || fail "no workers.dev address in the deploy output (see $LOG-deploy.log)"
  [ -z "$STUB" ] || URL="http://127.0.0.1:$PORT/"
  echo "Public address: $URL (version $VERSION)"
  # A new workers.dev name can take a moment to resolve.
  wait_http "$URL" 120 || fail "$URL did not answer within two minutes"
  # An HTTP 200 can still be an older edge deployment. Wait until this exact entry bundle is
  # served five times in a row before gameplay acceptance, retaining every mismatch.
  settle "$URL" "$DEST" "$LOG-assets.log" --feed || { tail -20 "$LOG-assets.log"; fail "public entry bundle did not settle on the frozen build within three minutes"; }
  tail -1 "$LOG-assets.log"
fi

# --- Frozen versions ------------------------------------------------------------------------
# This release's page and every one of its files, as its page asks for them, and the page of
# every earlier version (served from R2), fetched and hashed 16 at a time. Served locally (a dry
# run or a stub) there is no R2, so only this release is checked; staging checks them all.
FROZEN_SCOPE=""; { [ -n "$DRY" ] || [ -n "$STUB" ]; } && FROZEN_SCOPE="--new-only"
node tools/frozen-versions.mjs check "$URL" "$DEST" $FROZEN_SCOPE >"$LOG-frozen.log" 2>&1 \
  || { cat "$LOG-frozen.log"; fail "frozen version links are broken at $URL (see $LOG-frozen.log)"; }
tail -2 "$LOG-frozen.log"

# --- Smoke test -----------------------------------------------------------------------------
echo "Smoke testing $URL ..."
SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-normal.XXXXXX)" || fail "could not reserve smoke evidence directory"
echo "Shot evidence: $SHOT_PARENT/evidence ($URL)"
[ "${MIRA_RELEASE_FORCE_FAIL:-}" != smoke ] || fail "net-smoke failed against $URL (forced by MIRA_RELEASE_FORCE_FAIL=smoke)"
if [ -n "$DRY" ]; then
  run_smoke "$URL" "$LOG-smoke.log" "$SHOT_PARENT/evidence" || fail "net-smoke failed against $URL (see $LOG-smoke.log)"
  # Steps passed, connection drops ridden through and step retries, for the release ledger.
  SMOKE_SUMMARY="$(grep '^NET SMOKE SUMMARY ' "$LOG-smoke.log" | tail -1 | sed 's/^NET SMOKE SUMMARY //')"
else
  # Production: only what a deploy can break. The gameplay rules were proven on the same frozen
  # build by the full smoke on staging and in the dry run (tools/public-check.mjs).
  run_public_check "$URL" "$LOG-smoke.log" || fail "public check failed against $URL (see $LOG-smoke.log)"
  SMOKE_SUMMARY="$(grep '^PUBLIC CHECK ' "$LOG-smoke.log" | tail -1)"
fi

if [ -n "$DRY" ]; then
  npx tsx server/latency-proxy.ts --listen "$PROXY_PORT" --target "http://127.0.0.1:$PORT" --rtt 150 --jitter 30 >"$LOG-proxy.log" 2>&1 &
  PIDS="$PIDS $!"
  wait_http "http://127.0.0.1:$PROXY_PORT/" 30 || fail "latency proxy did not start"
  echo "Smoke testing through 150 ms round trip with 0 to 30 ms jitter each way..."
  SHOT_PARENT="$(mktemp -d /tmp/syn3h-shot-release-latency.XXXXXX)" || fail "could not reserve latency evidence directory"
  echo "Shot evidence: $SHOT_PARENT/evidence (latency)"
  run_smoke "http://127.0.0.1:$PROXY_PORT/" "$LOG-smoke-latency.log" "$SHOT_PARENT/evidence" || fail "net-smoke failed with latency (see $LOG-smoke-latency.log)"
  echo
  echo "DRY RUN OK: $MILESTONE ($COMMIT) frozen as $ID is deployable. Nothing was deployed or tagged."
  echo "Note: this repointed ../Syn3h-stable/current at $ID."
  exit 0
fi

# --- Primary public acceptance ---------------------------------------------------------------
# A workers.dev pass does not establish that the owner-facing domain serves the same assets.
PRIMARY_URL="https://mira.cc/"
settle "$PRIMARY_URL" "$DEST" "$LOG-primary-assets.log" --feed || { tail -20 "$LOG-primary-assets.log"; fail "primary entry bundle did not settle on the frozen build within three minutes"; }
tail -1 "$LOG-primary-assets.log"
if ! MIRA_SHORT_CHECK=1 tools/domain.sh check mira.cc >"$LOG-primary.log" 2>&1; then
  cat "$LOG-primary.log"
  fail "primary domain acceptance failed; roll back the deployment"
fi
cat "$LOG-primary.log"
node tools/frozen-versions.mjs check "$PRIMARY_URL" "$DEST" >"$LOG-primary-frozen.log" 2>&1 \
  || { cat "$LOG-primary-frozen.log"; fail "frozen version links are broken on the primary domain; roll back the deployment"; }
tail -2 "$LOG-primary-frozen.log"

[ -z "$STUB" ] || fail "stub run reached the record step; a stub records nothing"
# Accepted: from here on a failure does not roll back.
DEPLOYED=""

# The other addresses send players to mira.cc by Single Redirect rules outside the release
# (docs/MIRA-CUTOVER.md). A failure is reported loudly but does not undo the release, which cannot
# have caused it. On the old hosts only navigations are redirected. A page left open on the old
# www host still loads its lazy chunks and /v/versions.json from its own origin, and keeps its room
# socket. The old bare domain has been a redirect-only placeholder with no origin since 22 November
# 2026: no page was ever open there, so only its navigation redirect is checked.
OLD_HOSTS="www.syn3h.com syn3h.com" # rename-keep: the old addresses themselves
OPEN_PAGE_HOST="www.syn3h.com" # rename-keep: the old address pages may still be open on
address_check() { # <what went wrong>: a loud failure that does not fail the release
  printf '\nADDRESS CHECK FAILED: %s The release stands; fix the redirect rule.\n' "$1" >&2
}
probe="/?room=redirect-check&v=26.11.1503"
for host in www.mira.cc $OLD_HOSTS; do
  got="$(curl -s -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Dest: document' \
    -H 'Accept: text/html,application/xhtml+xml' "https://$host$probe" || true)"
  case "$got" in 30[1278]" https://mira.cc$probe") echo "Redirect ok: a page opened at https://$host/ goes to mira.cc with its path and query" ;;
    *) address_check "a page opened at https://$host$probe answered \"$got\", not a redirect to https://mira.cc$probe." ;; esac
done
for host in $OPEN_PAGE_HOST; do
  got="$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Dest: empty' -H 'Accept: application/json' "https://$host/v/versions.json" || true)"
  [ "$got" = 200 ] && echo "No redirect for a page's own fetches: https://$host/v/versions.json answers 200" \
    || address_check "https://$host/v/versions.json, fetched as an open page would, answered $got, not 200: pages left open there cannot load."
done
ws_code="$(curl -s -o /dev/null --http1.1 --max-time 5 -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://www.syn3h.com/ws?room=redirect-check" || true)" # rename-keep
[ "$ws_code" = 101 ] && echo "Old socket ok: the old host's /ws still upgrades" \
  || address_check "wss://www.syn3h.com/ws answered $ws_code, not 101: pages left open there lose their room." # rename-keep

# --- Record ---------------------------------------------------------------------------------
WHEN="$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "release-$N" "$WHEN" "$URL" "$MILESTONE" "$COMMIT" "$VERSION" "$ID" >> ../Syn3h-stable/releases.tsv
# Accepted: keep this release (a second copy in ../Syn3h-stable/versions) and store it in R2,
# verified, so later releases can serve it. A failure does not undo a verified release, but it is
# loud: the release ends with exit 1, and the next release's r2-preflight uploads it or stops.
ARCHIVE_FAILED=""
with_cf_token node tools/frozen-versions.mjs archive "$DEST" "$CALVER" >"$LOG-archive.log" 2>&1 || ARCHIVE_FAILED=1
tail -3 "$LOG-archive.log"
[ -z "$ARCHIVE_FAILED" ] || printf '\nARCHIVE FAILED: release-%s is live, but %s is not verified in R2 (see %s).\nRun: bash -c %s\n\n' "$N" "$CALVER" "$LOG-archive.log" "'. tools/cloudflare-token.sh; with_cf_token node tools/frozen-versions.mjs archive $DEST $CALVER'" >&2
git tag -a "release-$N" -m "release-$N: $NOTE ($URL, version $VERSION)" "$COMMIT_FULL"
if [ -n "$PROMOTE" ]; then
  # The owner's approval, in their own words, beside the version it approved.
  printf '%s\t%s\t%s\t%s\t%s\n' "$CALVER" "$WHEN" "$ID" "release-$N" "$APPROVAL" >> ../Syn3h-stable/approvals.tsv
  echo "Approval recorded for $CALVER: \"$APPROVAL\""
fi
echo
echo "RELEASE OK: release-$N is live at $URL"
echo "For ops/RELEASES.md:"
echo "- release-$N, $WHEN: $URL from $MILESTONE ($COMMIT), Worker version $VERSION, frozen copy $ID. $NOTE. Public smoke: ${SMOKE_SUMMARY:-no summary}."

# These artifacts describe an already verified release. A capture or draft failure must
# never turn a successful deploy into a failed release or trigger rollback.
if ! (
  printf '%s\t%s\t%s\t%s\tproduction\n' "$CALVER" "$MILESTONE" "$COMMIT" "$WHEN" >> release-notes/history.tsv || exit 1
  git tag -a "$CALVER" -m "Mira $CALVER ($MILESTONE, release-$N)" "$COMMIT_FULL" || exit 1
  # Notes are written and committed before the tag now; draft only when there are none.
  [ -f "release-notes/releases/$CALVER.md" ] || node tools/release-notes.mjs draft "$CALVER" "${PREV:-m00-proposal}" "release-$N"
); then
  echo "Warning: release is live; calendar tag or notes need repair. Inspect history before retrying."
fi
# The showcase is a separate step: a full-quality capture holds a heavy slot for about half an
# hour, so it never runs inside a release. See docs/RELEASE-SHOWCASE.md.
echo "Next, when no release is running: /Users/vtn/dev/Syn3h/tools/heavy.sh node tools/showcase.mjs --version $CALVER --publish"
echo "After pushing main and the tags: tools/vantage.sh $CALVER (the hosted check, with this release's own checker)"

# The second vantage point (the same short public check from a GitHub-hosted machine) is no
# longer started here: run tools/vantage.sh <version> after main and the tags are pushed, so the
# hosted machine checks out this release's own checker (docs/NAMES.md).

# Refresh aggregate dashboard tiles after the release record exists. The host supplies
# MIRA_SESSION_STATE; never store its value in the repository or published dashboard.
if [ -f tools/dashboard-stats.mjs ]; then
  if ! node tools/dashboard-stats.mjs >"$LOG-dashboard-stats.log" 2>&1; then
    echo "Warning: release is live; dashboard statistics need refresh. See $LOG-dashboard-stats.log."
  fi
fi

# Last, so every other step has run: a release whose archive failed ends in failure.
[ -z "${ARCHIVE_FAILED:-}" ] || { echo "release-$N is live but $CALVER is NOT stored in R2: run the archive command above before the next release." >&2; exit 1; }
