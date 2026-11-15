#!/bin/sh
# Venue fallback: serve the frozen production build from this Mac to the local network.
# Use it only when the public release cannot be reached. See docs/VENUE-FALLBACK.md.
#
#   tools/serve-venue.sh            # serves ../Syn3h-stable/current on port 8080
#   tools/serve-venue.sh 8081       # another port
#
# It runs the same Worker and room code as production, locally (`wrangler dev --local`), from
# the frozen copy, listening on every network interface. Nothing is deployed and nothing here
# needs Cloudflare access. Stop it with Ctrl C.
set -eu
cd "$(dirname "$0")/.."
REPO="$(pwd)"
PORT="${1:-8080}"
DEST="$(cd ../Syn3h-stable/current 2>/dev/null && pwd -P)" || { echo "No frozen build at ../Syn3h-stable/current. Run tools/promote-stable.sh first." >&2; exit 1; }
[ -f "$DEST/dist/index.html" ] || { echo "$DEST has no built client." >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then echo "Port $PORT is in use. Pass another port." >&2; exit 1; fi

# The address guests use: the Wi-Fi or Ethernet address of this Mac on the venue network.
IP=""
for dev in en0 en1 en2 en3 en4 en5 en6; do
  IP="$(ipconfig getifaddr "$dev" 2>/dev/null || true)"
  [ -n "$IP" ] && break
done
[ -n "$IP" ] || { echo "This Mac has no local network address. Join the venue Wi-Fi or start a hotspot first." >&2; exit 1; }

echo "Frozen build: $(cat "$DEST/dist/build.json")"
echo
echo "  Guests open:   http://$IP:$PORT/"
echo "  Projector:     open that same address on this Mac (not localhost), so the QR code"
echo "                 and invite links carry it."
echo "  Check first:   node tools/venue-check.mjs http://$IP:$PORT/"
echo
cd "$DEST"
exec node "$REPO/node_modules/wrangler/bin/wrangler.js" dev --local --port "$PORT" --ip 0.0.0.0
