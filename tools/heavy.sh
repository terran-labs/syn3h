#!/bin/sh
# Run one heavy job (vitest, a headless or headed Chrome, a build) without letting ten lanes
# on one machine starve each other.
#
#   tools/heavy.sh npx vitest run tests/net --maxWorkers=2
#   tools/heavy.sh node tools/smoke.mjs http://localhost:5183/ /tmp/x.png
#
# Unthrottled unless the machine is genuinely busy: when the 1 minute load average is below
# SYN3H_HEAVY_LOAD (default 12, about one per core here) the job runs at once and takes no
# slot. Only above that does it wait for one of SYN3H_HEAVY_SLOTS (default 8) machine-wide
# slots. SYN3H_HEAVY_BYPASS=1 always runs at once: for the trunk gate only, so landings never
# queue behind a lane's screenshots.
#
# Slots are directories under /tmp/syn3h-heavy. mkdir is atomic, so no two jobs share one.
# A slot older than 20 minutes is treated as abandoned and reclaimed.
SLOTS="${SYN3H_HEAVY_SLOTS:-8}"
LIMIT="${SYN3H_HEAVY_LOAD:-12}"
ROOT=/tmp/syn3h-heavy
mkdir -p "$ROOT"
[ -n "${SYN3H_HEAVY_BYPASS:-}" ] && exec "$@"
while :; do
  # Integer part of the 1 minute load average (macOS and Linux both print it after "load").
  LOAD="$(uptime | sed -E 's/.*load averages?:? *([0-9]+).*/\1/')"
  case "$LOAD" in ''|*[!0-9]*) LOAD=0 ;; esac
  [ "$LOAD" -lt "$LIMIT" ] && exec "$@"
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    S="$ROOT/slot-$i"
    if [ -d "$S" ] && [ -n "$(find "$S" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rm -rf "$S"; fi
    if mkdir "$S" 2>/dev/null; then
      echo "$$ $(date '+%H:%M:%S') $*" > "$S/owner"
      trap 'rm -rf "$S"' EXIT INT TERM
      "$@"
      exit $?
    fi
    i=$((i + 1))
  done
  sleep 3
done
