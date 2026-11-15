#!/bin/sh
set -eu
SYN3H_NO_ROOM_SERVER=1 SYN3H_ROOM_PORT=54671 VITE_SERVER_URL=ws://127.0.0.1:54671 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5214 --strictPort > /tmp/syn3h-ux-theme-halo-vite.log 2>&1 &
ux_vite_pid=$!
trap 'kill "$ux_vite_pid" 2>/dev/null || true; wait "$ux_vite_pid" 2>/dev/null || true' EXIT INT TERM
for ux_attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:5214/ > /dev/null; then break; fi
  sleep 1
done
# UX_TESTS runs several checks against one server; UX_TEST remains for a single one.
for ux_test in ${UX_TESTS:-${UX_TEST:-tests/ui/theme-halo.mjs}}; do node "$ux_test"; done
