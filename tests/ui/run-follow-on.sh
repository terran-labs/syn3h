#!/bin/sh
set -eu
SYN3H_NO_ROOM_SERVER=1 SYN3H_ROOM_PORT=54671 VITE_SERVER_URL=ws://127.0.0.1:54671 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort > /tmp/syn3h-ux-follow-on-vite.log 2>&1 &
ux_vite_pid=$!
trap 'kill "$ux_vite_pid" 2>/dev/null || true; wait "$ux_vite_pid" 2>/dev/null || true' EXIT INT TERM
for ux_attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:5198/ > /dev/null; then break; fi
  sleep 1
done
node "${UX_TEST:-tests/ui/follow-on.mjs}"
SYN3H_URL=http://127.0.0.1:5198/ node tests/ui/exploration.mjs
