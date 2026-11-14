# Path forward

Build order for the weekend, then what follows. Each step ends in something playable, so
stopping after any of them still leaves a working game. Nothing here is started; this is
the plan that goes with [PROPOSAL.md](PROPOSAL.md).

## Weekend

### 1. Foundation

Vite, TypeScript, Three.js `WebGPURenderer`, Rapier, a fixed 50 Hz loop with render
interpolation, keyboard and gamepad input, the parameter registry and its Tweakpane panel.

Done when: a box falls onto a plane at a steady rate on desktop Chrome and on your iPhone,
a gravity slider changes the fall live, and the page reports whether it is on WebGPU or the
WebGL fallback.

### 2. A volcano under an alien sky

Procedural heightfield with a caldera and lava lake, Rapier heightfield collider, slope and
height shading. `SkyMesh` with scattering sliders, a sun light tied to it, cascaded
shadows, sky coloured fog, a time of day slider and a day length slider.

Done when: dragging time of day moves the sun through sunrise, noon and sunset with the
terrain light and fog following, shadows hold from close up to the far rim, and a changed
scattering colour produces a visibly non Earth sky.

### 3. The buggy

Port `Buggy.js`: raycast suspension, virtual motor, friction curve, four wheel steering,
self righting, wings and glide, lava buoyancy. Chase camera. All original buggy sliders.

Done when: every input direction matches the original, the buggy climbs the volcano
flank, slides when traction is turned down, glides with wings open, skips across lava, and
each original slider has its expected effect across its original range.

This is the minimum result worth having. If the weekend ends here, it was a good weekend.

### 4. Multiplayer and shared sliders

Room server, join by link, snapshot interpolation, physical proxies near the player,
parameter sync with server side clamping, late join state.

Done when: two browsers on different networks see each other move smoothly, one buggy can
shove the other and both screens agree on roughly where they ended up, and a slider moved
by one player changes the world for the other within a moment.

Depends on the hosting decision in the proposal.

### 5. Hovercraft, tank, jet

Port in that order, cheapest first. The tank uses shape cast tracks in place of jointed
bodies. The jet gets both hover and flight modes. Vehicle switching in the UI.

Done when: each vehicle drives over the volcano with its original sliders working, the tank
can push a buggy uphill, and the jet can take off, stall, recover and land.

### 6. King of the Hill

Hill zone at the summit, server run clock and scores, lava death and respawn, a score HUD,
target score slider.

Done when: three players can play a full round to a winner.

### 7. Sound and the original look

Original music and effects, speed driven engine audio, converted original vehicle models,
touch controls for phones.

Done when: it sounds like Mars Explorer and the vehicles are recognisably yours.

Depends on Blender for the model conversion.

### Stretch: Earth by jet

A separate world that streams Google Photorealistic 3D Tiles around a chosen latitude and
longitude, with ground contact by raycast only.

Done when: the jet can fly through a city of your choice with correct attribution on
screen. Needs a Google Maps API key. Private use only until the collision question in
[real-world-cities.md](research/real-world-cities.md) is settled.

## Honest sizing

It is Saturday afternoon as this is written. Steps 1 to 4 are a realistic weekend. Steps 5
and 6 fit if the buggy port goes cleanly, because the other three vehicles are smaller than
the buggy. Step 7 and the stretch are likely to spill into the following week. The order is
chosen so that what spills is polish, not the core.

## After the weekend

1. **Presets as shareable worlds.** Seed plus parameter set behind a link.
2. **Real terrain.** Real Mars and real volcanoes from open elevation data, through the
   same heightfield path.
3. **Alien atmosphere, properly.** Evaluate precomputed atmospheric scattering for correct
   twilight and high altitude views.
4. **Lasers and tag,** the original game mode.
5. **Public hosting,** one room per Durable Object or similar.
6. **Original worlds.** Extract heightmaps from the Unity terrain assets for Freestyle,
   Lava Racer and the rest.
7. **Netcode upgrade** to WebTransport, and to server side physics only if cheating or
   contested shoves become a real problem.
8. **Cities,** by the routes compared in the research note.
