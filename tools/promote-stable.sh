#!/bin/sh
# Freeze the current build as the "stable" demo.
#
# Builds the production bundle, copies it with the Cloudflare worker source into a versioned
# directory outside the repo, and repoints ../Syn3h-stable/current at it. The stable preview
# uses tools/serve-stable.mjs with the snapshot's own room code and never hot reloads.
#
#   tools/promote-stable.sh "short note about this build"
set -eu
cd "$(dirname "$0")/.."
NOTE="${1:-}"
ID="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
DEST="../Syn3h-stable/$ID"
npm run build >/tmp/syn3h-stable-build.log 2>&1 || { tail -20 /tmp/syn3h-stable-build.log; exit 1; }
mkdir -p "$(dirname "$DEST")"
mkdir "$DEST"
cp -R dist wrangler.toml server shared src package.json tsconfig.json "$DEST/"
ln -sfn "$(pwd)/node_modules" "$DEST/node_modules"
node -e 'const fs = require("node:fs"); const [dest,id,commit,note] = process.argv.slice(1); fs.writeFileSync(dest + "/dist/build.json", JSON.stringify({id,commit,built:new Date().toISOString(),note,...(process.env.SYN3H_RELEASE_VERSION ? {version:process.env.SYN3H_RELEASE_VERSION} : {})}) + "\n")' "$DEST" "$ID" "$(git rev-parse HEAD)" "$NOTE"
ln -sfn "$ID" ../Syn3h-stable/current
echo "$ID"
