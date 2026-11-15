# Real world cities and terrain: paths forward

Researched 2026-11-14. Prices and policies are quoted from Google's pages as fetched that
day. Items marked **[unverified]** are from my own knowledge and were not checked against a
primary source in this pass.

## The three routes

### A. Stream Google Photorealistic 3D Tiles

The photogrammetry mesh behind Google Earth, streamed as OGC 3D Tiles and rendered in
Three.js with [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) (0.5.4,
published 2026-11-03).

- **Cost.** Billed per root tileset request, which starts a session of up to three hours.
  1,000 free per month, then 6.00 USD per 1,000 up to 100,000
  ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing)). Quota is
  10,000 root requests per day and 12,000 tile requests per minute
  ([usage](https://developers.google.com/maps/documentation/tile/usage-and-billing)).
  For a weekend with friends this is free.
- **Terms.** The [policy page](https://developers.google.com/maps/documentation/tile/policies)
  says the API is for map visualisation. It prohibits pre fetching, storing or caching
  beyond the response headers, offline use, "geodata extraction", "object detection", and
  creating content such as "3D or terrain models" from the tiles. It requires the Google
  logo and a line of data attributions on screen.
- **What that means for a game.** Rendering the tiles and flying through them is plainly
  allowed. Building physics colliders from the tile geometry is not addressed anywhere. It
  never leaves memory and nothing is stored, but a strict reading of "non visualisation
  use" could cover it. I cannot resolve that from the text. For a private demo the
  practical risk is negligible. For a public game with Google's data as the playfield, get
  an answer from Google first.
- **Technical fit.**
  - Looks spectacular from a jet. Looks melted at street level: trees are blobs, cars are
    baked into the road, and nothing is flat.
  - No semantics. There is no "road", only triangles.
  - The mesh under you changes as levels of detail load, so collision geometry has to be
    pinned to one level near the vehicle or it will pop.
  - Our vehicles help here. The buggy and hovercraft touch the ground only
    through raycasts, so they can raycast against the visible tile meshes with
    [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and need no physics
    colliders for terrain at all. Only chassis impacts need real colliders.
  - The tileset is in Earth centred coordinates with values in the millions of metres.
    Reorient it so a chosen latitude and longitude sits at the origin, and recentre
    periodically for the jet.
  - Memory. The renderer's cache is a hard cap: when full, refinement stops. Teleoperator's
    notes put the iOS tab limit near 1 to 1.5 GB, so phones need a small cache and a short
    view distance.
- **Effort.** A jet flyover of any city is an afternoon. Drivable streets that feel good
  are not achievable with this data at any effort.

### B. Bake a city offline from open data (Teleoperator's route)

Generate your own optimised city model ahead of time from OpenStreetMap roads and building
footprints, public elevation data, and municipal open data.

- **Licensing.** OpenStreetMap is ODbL: attribution required, and a derived database must be
  shared under the same licence. USGS 3DEP elevation is public domain. Clean for a public
  game.
- **Fit.** Roads are flat and continuous by construction. Buildings are simple prisms that
  collide cheaply. It loads fast and costs nothing per session.
- **Cost.** A real content pipeline: road meshing with intersections, bridges and tunnels,
  terrain conforming, building generation, texturing, tiling and compression. Teleoperator
  shows the result is excellent and that it took many iterations for a single city.
- **Effort.** Weeks for the first city. Not a weekend item.

### C. Real elevation with generated buildings at runtime

Fetch open elevation tiles for any location, build a heightfield, and extrude building
footprints from open vector tiles on top.

- **Fit with this project.** A heightfield is exactly what the rest of the game already
  uses for alien terrain, so real places become just another world source. Physics is a
  normal heightfield collider. Buildings are boxes.
- **Data.** Global elevation at roughly 30 m and United States elevation at 10 m are openly
  available as web tiles, and building footprints are available from OpenStreetMap and
  Overture Maps. **[unverified]** I did not confirm current hosts, formats or rate limits
  today.
- **Looks.** Much plainer than Google's mesh unless we also drape imagery, which brings its
  own licensing question.
- **Effort.** Real terrain you can drive on is a day or two. Buildings add a few more.

## An idea worth more than any of these for this project

Route C works on any planet with a published elevation model. NASA and USGS publish global
Mars elevation from the MOLA instrument, and far finer data for selected regions.
**[unverified]** as to exact resolution and hosting. A world called Olympus Mons that is
the actual Olympus Mons, or a race along the real Valles Marineris, fits the name Mars
Explorer better than San Francisco does, has no licensing problem, and reuses the terrain
system we are building anyway. Real volcanoes on Earth work the same way.

## Multiplayer over real terrain

Nothing changes in the netcode as long as every client in a room uses the same anchor. The
room stores one latitude, longitude and heading. Each client places that point at its local
origin and all positions on the wire are metres east, north and up from it. With streamed
tiles, two players may momentarily see different levels of detail under a remote vehicle,
which shows up as a wheel sinking or floating by a small amount. Owner authoritative
vehicles hide most of this, because each player's own ground contact is always computed
against what that player sees.

## Recommendation

1. **This weekend, keep real world data off the critical path.** It is not part of the
   experience you described as primary, and none of it helps the buggy feel good.
2. **Sunday stretch goal: Route A as a jet only "Earth" world.** Low effort, high wow, free
   at this scale, private use. Raycast ground contact only.
3. **Next: Route C,** starting with real Mars and real volcanoes, because it shares the
   heightfield terrain system and gives drivable ground.
4. **Later, if a flagship city matters: Route B** for that one city.

Do not plan a public release on Route A until Google has said in writing that game physics
against the tiles is acceptable.
