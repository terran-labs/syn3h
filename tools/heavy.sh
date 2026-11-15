#!/bin/sh
# Run one heavy job (vitest, a headless or headed Chrome, a build) without letting ten lanes
# on one machine starve each other.
#
#   tools/heavy.sh npx vitest run tests/net --maxWorkers=2
#   tools/heavy.sh node tools/smoke.mjs http://localhost:5183/ /tmp/x.png
#
# Every job takes a slot, even when the machine is idle. Letting all lanes skip the
# semaphore below a load threshold caused a simultaneous restart to launch an entire
# machine's backlog before the load average caught up. Three jobs keep CPU capacity for
# the preview broker and interactive work. The trunk's short landing gate may bypass.
SLOTS="${SYN3H_HEAVY_SLOTS:-3}"
ROOT=/tmp/syn3h-heavy
mkdir -p "$ROOT"
# Heavy jobs run at low priority and with few test workers each, so interactive things on
# this machine keep getting CPU: the preview broker's health checks time out and unmap every
# preview link when load is high (seen 14 November, 11:15pm), and vitest otherwise starts one
# worker per core for every lane at once.
: "${VITEST_MAX_WORKERS:=3}"; : "${VITEST_MAX_THREADS:=3}"; : "${VITEST_MAX_FORKS:=3}"
export VITEST_MAX_WORKERS VITEST_MAX_THREADS VITEST_MAX_FORKS
[ -n "${SYN3H_HEAVY_BYPASS:-}" ] && exec nice -n 5 "$@"
while :; do
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    S="$ROOT/slot-$i"
    if [ -d "$S" ] && [ -n "$(find "$S" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rm -rf "$S"; fi
    if mkdir "$S" 2>/dev/null; then
      echo "$$ $(date '+%H:%M:%S') $*" > "$S/owner"
      trap 'rm -rf "$S"' EXIT INT TERM
      nice -n 10 "$@"
      exit $?
    fi
    i=$((i + 1))
  done
  sleep 3
done
