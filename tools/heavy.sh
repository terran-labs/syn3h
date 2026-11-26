#!/bin/sh
# Run one heavy job (vitest, a headless or headed Chrome, a build) without letting ten lanes
# on one machine starve each other.
#
#   tools/heavy.sh npx vitest run tests/net --maxWorkers=2
#   tools/heavy.sh node tools/smoke.mjs http://localhost:5183/ /tmp/x.png
#   tools/heavy.sh status      who holds each slot, for how long, and who waits (takes no slot)
#
# A job is stopped after MIRA_HEAVY_TIMEOUT_S seconds (default 1800; 0 for none): its own process
# group only, with the slot freed and a line in heavy.log in the slot folder.
#
# Every job takes a slot, even when the machine is idle. Letting all lanes skip the
# semaphore below a load threshold caused a simultaneous restart to launch an entire
# machine's backlog before the load average caught up. Three jobs keep CPU capacity for
# the preview broker and interactive work. The trunk's short landing gate may bypass.
# Rollout requires draining every old wrapper and queued waiter first. All callers use
# the absolute trunk helper, so old worktrees cannot silently revive the old semaphore.
# Kernel locks cannot expire beneath a live job. Children inherit the lock descriptor,
# so killing a wrapper does not release a still-running command's slot.
. "$(dirname "$0")/lib/legacy-env.sh" # legacy environment names, see docs/NAMES.md
: "${VITEST_MAX_WORKERS:=2}"; : "${VITEST_MAX_THREADS:=2}"; : "${VITEST_MAX_FORKS:=2}"
export VITEST_MAX_WORKERS VITEST_MAX_THREADS VITEST_MAX_FORKS
[ "$*" = status ] && exec python3 "$(dirname "$0")/heavy.py" status
[ -n "${MIRA_HEAVY_BYPASS:-}" ] && exec nice -n 5 "$@"
exec python3 "$(dirname "$0")/heavy.py" "$@"
