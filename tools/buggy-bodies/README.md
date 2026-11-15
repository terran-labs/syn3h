# Buggy body variations

`build.py` builds the body variations listed in `variants.py` from the owner's original
`Buggy.blend` (Syn3h client, `Assets/_Actors/Packages/Buggy/Components/Meshes/`) and writes them
to `labs/buggy-bodies/` with an `index.json` the gallery reads. `labs/` is served by the dev
server from the repository root but is not copied into the production build, so review models
do not ship with the game.

    tools/heavy.sh blender -b --python tools/buggy-bodies/build.py -- \
        <path to Buggy.blend> "$PWD/labs/buggy-bodies" [<preview dir>|-] [variant ids...]

Needs Blender 5 (`/opt/homebrew/bin/blender`). Each body starts from the original Body and
Cockpit meshes: proportions change through smooth deformations, the spoiler and canopy are
restyled, and the surface is subdivided once. The original headlight and tail light faces are
kept, under the materials `Headlights` and `TailLights`.

The gallery is the vehicle lab, `vehicle-lab.html?vehicle=buggy` (`src/dev/vehicleLab/exhibits/buggy.ts`; see `docs/vehicle-lab.md`). It is a review
page for the owner; the game does not load these bodies yet.
