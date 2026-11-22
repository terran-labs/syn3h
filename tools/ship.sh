#!/bin/sh
# Ship a production release the way the Orchestrator does: wait out the gap after the last
# release, prove it with a dry run, wait at the load gate, then run tools/release.sh. Holds the
# machine for heavy jobs throughout (tools/heavy.py), by phase:
#   gate     from the gate wait until release.sh starts: no other heavy job starts at all,
#            because extra load is what keeps a release waiting at its gate;
#   running  written by release.sh itself: one other heavy job may share a slot beside it.
# A job already running is never stopped. The hold names this script's PID, then release.sh's,
# so it lifts when either ends, even if killed.
#
#   tools/ship.sh <release number> "<note>"
#
# Start it in its own session so a tool runner cannot end it with a background task, and
# watch the outcome files, not the process:
#   nohup python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
#     tools/ship.sh N "note" > /tmp/syn3h-ship-N.out 2>&1 &
# Outcome files: /tmp/syn3h-ship-N-dry.log and .rc (dry run), /tmp/syn3h-ship-N-release.log
# and .rc (the release); /tmp/syn3h-ship-N.done is written last with the final status.
#
# Settings (environment; defaults are the Foreman's rules of 21 November 2026):
#   SYN3H_SHIP_GAP_S      900   seconds after the last recorded release before starting
#   SYN3H_GATE_LOAD       12    the one-minute load average must stay below this...
#   SYN3H_GATE_HOLD_S     120   ...for this long without a break
#   SYN3H_GATE_TIMEOUT_S  3600  give up (no release) if the gate has not passed by then
#   SYN3H_GATE_POLL_S     10    how often to read the load
#   SYN3H_SHIP_DRY        1     0 skips the dry run
#   SYN3H_SHIP_RELEASE    tools/release.sh, SYN3H_SHIP_OUT /tmp, SYN3H_SHIP_STABLE ../Syn3h-stable: for tests
set -u
cd "$(dirname "$0")/.."
N="${1:-}"; NOTE="${2:-}"
case "$N" in ''|*[!0-9]*) echo "usage: tools/ship.sh <n> \"note\"" >&2; exit 2 ;; esac
[ -n "$NOTE" ] || { echo "ship.sh: give a note" >&2; exit 2; }
GAP="${SYN3H_SHIP_GAP_S:-900}"; LIMIT="${SYN3H_GATE_LOAD:-12}"; HOLD_S="${SYN3H_GATE_HOLD_S:-120}"
TIMEOUT="${SYN3H_GATE_TIMEOUT_S:-3600}"; POLL="${SYN3H_GATE_POLL_S:-10}"
RELEASE="${SYN3H_SHIP_RELEASE:-tools/release.sh}"; OUT="${SYN3H_SHIP_OUT:-/tmp}/syn3h-ship-$N"
STABLE="${SYN3H_SHIP_STABLE:-../Syn3h-stable}"
HOLD_ROOT="${SYN3H_HEAVY_ROOT:-/tmp/syn3h-heavy-v2}"; HOLD="$HOLD_ROOT/hold"
rm -f "$OUT-dry.rc" "$OUT-release.rc" "$OUT.done"
finish() { echo "$1" > "$OUT.done"; echo "DONE: $1"; exit 0; }
# Our own hold only: never remove one naming another process (release.sh's, or another ship).
unhold() { [ "$(head -1 "$HOLD" 2>/dev/null)" = "$$" ] && rm -f "$HOLD"; return 0; }
trap unhold EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The version this ships as, and whether the notes are for it, before any waiting: a train
# prepared before midnight Pacific ships with the next day's number (release.sh checks again
# when it starts, in case midnight passes during the gap or the gate).
VERSION="$(node tools/release-notes.mjs next)" || finish "could not compute the version"
echo "Version: $VERSION"
node tools/release-notes.mjs check "$VERSION" || finish "the release notes are not for $VERSION; nothing released (see the fix above)"

# The gap after the last release, so queued builder jobs can run between releases.
LAST="$STABLE/releases.tsv"
if [ "$GAP" -gt 0 ] && [ -f "$LAST" ]; then
  until=$(( $(stat -f %m "$LAST") + GAP ))
  while [ "$(date +%s)" -lt "$until" ]; do sleep 20; done
  echo "GAP OK: $GAP s after the last recorded release"
fi

# The dry run (a release.sh run of its own: it holds the machine 'running' while it lasts).
if [ "${SYN3H_SHIP_DRY:-1}" != 0 ]; then
  PREV="$(readlink "$STABLE/current" 2>/dev/null || true)"
  "$RELEASE" "$N" "$NOTE" --dry-run > "$OUT-dry.log" 2>&1; rc=$?; echo "$rc" > "$OUT-dry.rc"
  # A dry run repoints the stable channel at its own copy; put it back.
  [ -z "$PREV" ] || ln -sfn "$PREV" "$STABLE/current"
  echo "DRY rc=$rc $(grep -E '^DRY RUN' "$OUT-dry.log" | tail -1)"
  [ "$rc" -eq 0 ] || finish "dry run failed rc=$rc"
fi

# The gate: hold the machine fully ('gate') and wait for the load to stay low.
mkdir -p "$HOLD_ROOT"; printf '%s\ngate\n' "$$" > "$HOLD"
start=$(date +%s); since=0
while :; do
  load=$(sysctl -n vm.loadavg | awk '{print $2}'); now=$(date +%s)
  if awk "BEGIN{exit !($load < $LIMIT)}"; then
    [ "$since" -eq 0 ] && since=$now
    if [ $((now - since)) -ge "$HOLD_S" ]; then echo "GATE PASSED load=$load at $(date '+%H:%M:%S')"; break; fi
  else
    since=0; echo "GATE WAIT load=$load at $(date '+%H:%M:%S')"
  fi
  [ $((now - start)) -lt "$TIMEOUT" ] || finish "gate timeout after $TIMEOUT s; nothing released"
  sleep "$POLL"
done

# The release takes the hold over ('running') as it starts; ours stays until then.
echo "START $(date '+%H:%M:%S') load $(sysctl -n vm.loadavg)"
"$RELEASE" "$N" "$NOTE" > "$OUT-release.log" 2>&1; rc=$?; echo "$rc" > "$OUT-release.rc"
echo "END $(date '+%H:%M:%S') release rc=$rc"
finish "release rc=$rc"
