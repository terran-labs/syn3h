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
# Rollout requires draining every old wrapper and queued waiter first. All callers use
# the absolute trunk helper, so old worktrees cannot silently revive the old semaphore.
# Kernel locks cannot expire beneath a live job. Children inherit the lock descriptor,
# so killing a wrapper does not release a still-running command's slot.
: "${VITEST_MAX_WORKERS:=2}"; : "${VITEST_MAX_THREADS:=2}"; : "${VITEST_MAX_FORKS:=2}"
export VITEST_MAX_WORKERS VITEST_MAX_THREADS VITEST_MAX_FORKS
[ -n "${SYN3H_HEAVY_BYPASS:-}" ] && exec nice -n 5 "$@"
exec python3 "$(dirname "$0")/heavy.py" "$@"
