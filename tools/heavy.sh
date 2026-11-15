#!/bin/sh
# Run one heavy job (vitest, a headless or headed Chrome, a build) while holding one of a
# few machine-wide slots, so ten lanes on one machine do not starve each other.
#
#   tools/heavy.sh npx vitest run tests/net --maxWorkers=2
#   tools/heavy.sh node tools/smoke.mjs http://localhost:5183/ /tmp/x.png
#
# Slots are directories under /tmp/syn3h-heavy. mkdir is atomic, so no two jobs share one.
# A slot older than 20 minutes is treated as abandoned and reclaimed.
SLOTS="${SYN3H_HEAVY_SLOTS:-3}"
ROOT=/tmp/syn3h-heavy
mkdir -p "$ROOT"
while :; do
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
