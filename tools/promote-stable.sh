#!/bin/sh
# Freeze the current build as the "stable" demo.
#
# Builds the production bundle, copies it with the Cloudflare worker source into a versioned
# directory outside the repo, and repoints ../Syn3h-stable/current at it. The stable preview
# serves that directory with wrangler's local runtime, so it is the same code path as the
# real deployment, has its own room server, and never hot reloads.
#
#   tools/promote-stable.sh "short note about this build"
set -eu
cd "$(dirname "$0")/.."
NOTE="${1:-}"
ID="$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
DEST="../Syn3h-stable/$ID"
npm run build >/tmp/syn3h-stable-build.log 2>&1 || { tail -20 /tmp/syn3h-stable-build.log; exit 1; }
mkdir -p "$DEST"
cp -R dist wrangler.toml server shared package.json tsconfig.json "$DEST/"
ln -sfn "$(pwd)/node_modules" "$DEST/node_modules"
printf '{"id":"%s","commit":"%s","built":"%s","note":"%s"}\n' "$ID" "$(git rev-parse --short HEAD)" "$(date '+%Y-%m-%d %H:%M %Z')" "$NOTE" > "$DEST/dist/build.json"
ln -sfn "$ID" ../Syn3h-stable/current
echo "$ID"
