#!/bin/sh
# Runs UX browser checks against a dev server and a room server started from THIS tree.
#
#   UX_TESTS="tests/ui/a.mjs tests/ui/b.mjs" tools/heavy.sh sh tests/ui/run-follow-on.sh
#
# A test must never reach another lane's server or a stale one, so both ports are checked
# before anything starts and the run refuses to begin if either is taken. The dev server
# spawns the room server (vite.config.ts) on UX_ROOM_PORT; both are stopped at the end.
# UX_PORT and UX_ROOM_PORT choose other ports; UX_VIEW limits checks that support it.
. "$(dirname "$0")/../../tools/lib/legacy-env.sh" # legacy environment names, see docs/NAMES.md
set -eu
ux_port=${UX_PORT:-5198}
ux_room_port=${UX_ROOM_PORT:-5298}
ux_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; }
for ux_check in "$ux_port" "$ux_room_port"; do
  if ux_busy "$ux_check"; then echo "run-follow-on: port $ux_check is already in use; refusing to start"; exit 2; fi
done
MIRA_ROOM_PORT=$ux_room_port VITE_SERVER_URL=ws://127.0.0.1:$ux_room_port node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$ux_port" --strictPort > /tmp/syn3h-ux-follow-on-vite.log 2>&1 &
ux_vite_pid=$!
ux_stop() {
  kill "$ux_vite_pid" 2>/dev/null || true; wait "$ux_vite_pid" 2>/dev/null || true
  # The room server is a grandchild of the dev server. The port was free before this run
  # started, so anything still listening on it now is ours: do not leave it behind.
  for ux_try in 1 2 3 4 5; do ux_busy "$ux_room_port" || break; sleep 1; done
  if ux_busy "$ux_room_port"; then
    for ux_pid in $(lsof -nP -t -iTCP:"$ux_room_port" -sTCP:LISTEN 2>/dev/null); do kill "$ux_pid" 2>/dev/null || true; done
  fi
}
trap ux_stop EXIT INT TERM
for ux_attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$ux_port/" > /dev/null 2>&1; then break; fi
  sleep 1
done
for ux_attempt in $(seq 1 60); do
  if ux_busy "$ux_room_port"; then break; fi
  sleep 1
done
if ! ux_busy "$ux_room_port"; then echo "run-follow-on: the room server did not start on port $ux_room_port"; exit 2; fi
export MIRA_URL="http://127.0.0.1:$ux_port/" UX_ROOM_PORT="$ux_room_port"
# UX_TESTS runs several checks against one server; UX_TEST remains for a single one.
# One failing check must not hide the others: run them all, then report which failed.
ux_failed=""
for ux_test in ${UX_TESTS:-${UX_TEST:-tests/ui/follow-on.mjs}}; do node "$ux_test" || ux_failed="$ux_failed $ux_test"; done
node tests/ui/exploration.mjs || ux_failed="$ux_failed tests/ui/exploration.mjs"
if [ -n "$ux_failed" ]; then echo "FAILED:$ux_failed"; exit 1; fi
echo "ALL PASSED"
