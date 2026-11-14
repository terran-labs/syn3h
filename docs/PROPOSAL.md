# Syn3h for the browser: proposal

2026-11-14. Status: proposed, nothing built.

## The goal for this weekend

In your words: super satisfying off road sci fi vehicle physics, lighting that is never
baked so alien sunrises and sunsets can be procedural, and basic multiplayer, so you can
drive a tank to the top of a volcano and play King of the Hill with a few friends. Around
that, as many physics, vehicle and environment sliders as possible, shared live between
everyone in the world.

Everything below is ranked against that. Real world cities are a stretch goal.

## Summary of recommendations

| Question | Recommendation |
| --- | --- |
| Use Three.js? | Yes. Three.js r187 with `WebGPURenderer` and TSL, with its automatic WebGL 2 fallback. |
| Physics | Rapier 0.21 for rigid bodies, collisions and raycasts. Vehicle forces ported from the original Mars Explorer scripts, not Rapier's car controller. |
| Timestep | Fixed 50 Hz with render interpolation. |
| Sky and light | Three's `SkyMesh` for day one sliders, one sun light with cascaded shadows, fog tied to the sky. Fork the sky shader to expose per colour scattering for alien atmospheres. |
| Terrain | Procedural heightfield volcano, one Rapier heightfield collider, slope and height based shading in TSL. |
| Multiplayer | Mars Explorer's own model: each player simulates their own vehicle, a small WebSocket room server relays state, nearby remote vehicles stay physical so ramming works. |
| Sliders | One typed parameter registry that drives the UI, the network sync, saved presets and the simulation. |
| Language and build | TypeScript, Vite, npm workspaces with a client and a tiny Node server. |
| Real world | Not this weekend's core. Google tiles as a jet only stretch. Real Mars elevation next. See [real-world-cities.md](research/real-world-cities.md). |

## Why this is feasible in a weekend

I expected the vehicle physics to be the risk. It is the opposite. The original game never
used Unity's wheel physics. The buggy, hovercraft, tank and jet are each a single rigid body
with raycasts and hand applied forces, about 1,000 lines in total, with every constant
visible ([mars-explorer.md](architecture/mars-explorer.md)). That code ports to Rapier
nearly line for line, and the feel comes with it.

The network model is also already designed. Mars Explorer's ramming worked because remote
vehicles near you stayed live physics bodies that were nudged toward their network
position. That is exactly King of the Hill.

What the old games got from Unity or from paid Unity assets is where the work is: sky,
terrain rendering, shadows, water. Those are the parts to keep deliberately simple.

## Rendering

**Three.js r187, `WebGPURenderer`, TSL materials.**

- Both of your reference games use it. Bruno Simon's site is on 0.187 and Teleoperator on
  r186, both with the WebGPU renderer ([reference-games.md](research/reference-games.md)).
  Bruno's is MIT licensed, so its lighting material, game loop and quality tiers are there
  to study and borrow.
- TSL shaders compile to both WGSL and GLSL, so one set of materials covers WebGPU and the
  WebGL 2 fallback.
- r187 ships what we need as addons: `SkyMesh`, `CSMShadowNode` for cascaded shadows,
  `WaterMesh`, and node based bloom, god rays and anti aliasing.
- Browser support: WebGPU is in Chrome and Edge, in Safari 26 on macOS and iOS, and in
  Firefox on Windows and Apple Silicon Macs. Firefox on Android and Linux still lack it
  ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers)). The fallback covers
  those.

Alternatives considered:

- **Raw WebGPU.** Maximum control, and a week of work before the first lit triangle with a
  shadow. Wrong trade for a weekend. Teleoperator shows you can drop to hand written WGSL
  inside Three later where it pays.
- **Babylon.js 9.** A fuller engine with first class Havok physics. A reasonable choice in
  the abstract. Against it: neither inspiration uses it, so there is no working code to
  learn from, and we would use Havok only as a rigid body engine, which Rapier already is.
- **PlayCanvas.** Editor centred. That workflow does not suit a code first weekend.

## Physics

**Rapier 0.21 (`@dimforge/rapier3d`), used as a rigid body and query engine.**

- Small WASM download, fast, a first class heightfield collider, good raycasts. Bruno's
  site proves it on phones. I confirmed 0.21.0 is current on npm; the public changelog I
  could read stops at 0.19.3, so I have not verified what changed since.
- **Do not use Rapier's ray cast vehicle controller for our vehicles.** It is a tidy road
  car model with per wheel stiffness, friction slip and engine force. Bruno uses it and it
  suits his car. It cannot represent a hovercraft or a jet, is wrong for a tracked tank, and
  would replace the buggy's distinctive friction curve with a generic one. Each vehicle
  becomes a TypeScript class that reads inputs and parameters and calls `castRay`,
  `addForceAtPoint` and `addTorque` on a Rapier body, exactly as the originals did on a
  Unity rigid body.
- **Tank.** The original hung six jointed track bodies off the hull and drove them from
  collision callbacks. Replace that with three shape casts per side that apply the same
  force formula at their contact points. It keeps the skid steer and the climbing behaviour,
  removes six bodies and six joints per tank, and is far steadier over a network.
- **Jolt Physics** has purpose built wheeled and tracked vehicle constraints and is the
  runner up. Its vehicle models are again not ours, and neither reference game uses it, so
  there is no working example to lean on. I did not compare download sizes. Revisit it
  only if Rapier's stacking or contact quality disappoints during ramming.
- **Fixed 50 Hz step.** Unity's default, which the original constants assume, and required
  for clients to agree. Render at display rate and interpolate.

Porting hazards (handedness, Unity's drag formula, Euler order, layer masks) are listed in
[mars-explorer.md](architecture/mars-explorer.md#porting-hazards). The plan is to port the
buggy first, verify every control direction and every slider against the original
behaviour, then reuse that harness for the other three.

## Sky, sun and lighting

Nothing is baked. One sun direction drives everything.

1. **Sky.** Start with Three's `SkyMesh`. It is an analytical Preetham sky written in TSL
   and already exposes turbidity, Rayleigh, Mie coefficient, Mie directional g, sun position
   and a procedural cloud layer with coverage, density, scale, speed and elevation. All of
   those become sliders on the first evening.
2. **Alien skies.** In that model "Rayleigh" is one multiplier over Earth's wavelengths, so
   it can make the sky more or less blue but not green or violet. The fix is small: copy the
   shader into the project and promote the scattering colour to a parameter. Then a slider
   set can describe a methane sky or a dusty Martian one where the sunset is blue.
3. **Sunlight.** One directional light. Its direction is the sky's sun position. Its colour
   and intensity are computed from the same scattering terms so the ground turns orange
   when the sky does. Cascaded shadow maps through `CSMShadowNode`, because a volcano needs
   shadows from one metre to several kilometres.
4. **Ambient and fog.** A hemisphere term sampled from the sky colour at zenith and horizon.
   Distance fog uses the horizon colour so terrain dissolves into the sky.
5. **Style.** Bruno Simon's material adds a tinted shadow colour and a fake bounce light.
   It reads beautifully and costs almost nothing. Adopt the idea for terrain and vehicles.
6. **Later.** `@takram/three-atmosphere` implements precomputed atmospheric scattering, the
   physically based model behind most modern engines, and its repository marks WebGPU
   support as done. It would give correct twilight and views from altitude. I did not verify
   whether its planet and scattering constants can change at runtime, and that is the
   feature you care about most, so it stays a later evaluation.

Weather for the weekend means cloud coverage, fog density, wind for particles and a time of
day speed. Rain and storms are later.

## Terrain

- A procedural heightfield, generated at load from a seed and a handful of parameters:
  a volcano cone with a caldera, ridged noise for flanks, a lava lake inside. 1,025 by 1,025
  samples over about 4 km is a few megabytes and one Rapier heightfield collider.
- Rendered as a grid with a simple distance based level of detail. Shaded in TSL by slope
  and altitude with triplanar detail textures, so no painted splat maps are needed.
- Terrain parameters are sliders too, but regenerating the collider is a hitch, so those
  apply on release instead of continuously.
- Lava and sea are a plane at a slider controlled altitude, as in the original, with each
  vehicle's original buoyancy code.
- The original worlds' heightmaps are locked in binary Unity `TerrainData` assets.
  Extracting them is possible and is a later item.

## Multiplayer

**Owner authoritative vehicles, relayed through a room server, with physical proxies.**

- Each client simulates only its own vehicle and sends position, rotation, linear and
  angular velocity and current inputs 20 times a second in a compact binary message.
- Remote vehicles are rendered slightly in the past from a snapshot buffer, as in
  `VehicleNet.js`.
- Remote vehicles within about 40 m of you stay dynamic Rapier bodies steered toward their
  snapshots, so collisions are real on both screens. Sending velocities, which the original
  did not, makes those proxies hit with the right momentum.
- The room server owns only what must be agreed: who is in the room, the shared parameter
  values, and the King of the Hill clock and scores.
- Transport is WebSocket. For four to eight players on decent connections it is enough.
  Its weakness is that one lost packet delays everything behind it. WebTransport removes
  that, and Safari gained it in 26.4 in March 2026, but I could not confirm datagram
  behaviour on Safari, so it is an upgrade to test later, behind the same interface.

What this model costs, plainly:

- Pushing matches feel right up to roughly 100 ms of latency and get mushy beyond it. Each
  player sees the other slightly in the past, so both can believe they won a shove.
- Any player can cheat, because each client is trusted about its own position.
- The alternative is server side physics with client prediction and rollback. It fixes both
  problems and is a multi week netcode project. It is the wrong first step for a game among
  friends, and the room interface can be kept narrow enough to swap later.

**Server.** A Node process using the `ws` library, about 200 lines, one room per URL. For
public hosting later, the same logic fits a Cloudflare Durable Object per room. Where it
runs this weekend is an open decision below.

## The slider system

Mars Explorer already had this. `Settings.js` held about 55 shared values, drew a slider for
each, and sent the whole set from the host as one string. The rebuild should make it the
spine of the code.

One registry, declared once:

```ts
defineParam({
  id: 'buggy.traction',
  label: 'Traction',
  group: 'Buggy',
  scope: 'world',          // 'world' is shared, 'client' is personal
  min: 0.1, max: 1.9, step: 0.01, default: 1.0,
})
```

Everything else is derived from it:

- **UI.** A Tweakpane panel generated from the registry, grouped and searchable.
- **Simulation and rendering.** Vehicle code reads `params.buggy.traction`. Shader
  parameters bind straight to TSL uniforms, so sky sliders cost nothing per frame.
- **Network.** A change sends `{id, value}`. The server clamps it to the declared range,
  stores it and rebroadcasts. Late joiners receive the full set.
- **Presets.** The full set serialises to a small JSON document. A world is then a seed plus
  a preset, which can be saved, shared as a link, and loaded. This is the modern form of a
  Whirld.
- **Defaults.** The original slider ranges are recorded in
  [mars-explorer.md](architecture/mars-explorer.md#the-settings-system) and go in unchanged.

Initial groups: World (gravity, time of day, day length, lava altitude, view distance),
Sky (Rayleigh colour and strength, Mie, turbidity, sun size, clouds), Weather (fog, wind),
Terrain (seed, height, roughness, caldera size), one group per vehicle, and Network
(interpolation delay, proxy radius).

One design choice for you: in Mars Explorer only the host could change shared values. With
friends it is more fun if everyone can, and more chaotic. I would default to everyone, with
a host lock toggle.

## King of the Hill

- A hill zone, a cylinder at the caldera rim or summit, shown as a beam of light.
- The server runs the clock. Whoever is alone in the zone scores each second. Contested
  means nobody scores.
- Lava destroys and respawns you at the base. So does falling off the world, as before.
- First to a target score wins, and the target is a slider.

## Assets and audio

You have confirmed you own the original vehicles, soundtrack and logos and that they can be
reused.

- Vehicle models exist as `.blend` and `.3ds` files across the two repositories. They need
  converting to glTF, which needs Blender. It is not installed on this machine.
- Until then, vehicles are built from primitives. The physics does not depend on the art.
- The original music and effects are MP3 files and play as they are. Use the Web Audio API
  directly for engine sounds that follow speed and throttle, and Howler for music and one
  shot effects if it saves time.
- One Syn3h track, by its filename, is a third party recording. Leave it out until its
  licence is checked.

## Project layout

```
packages/
  shared/    parameter registry, message formats, constants
  client/    Vite + TypeScript + Three.js + Rapier
    src/core/      fixed step loop, input, params, quality tiers
    src/world/     terrain, sky, sun, fog, lava
    src/vehicles/  Vehicle base, Buggy, Hovercraft, Tank, Jet
    src/net/       room client, snapshot buffer, proxies
    src/modes/     King of the Hill
    src/ui/        slider panel, HUD
  server/    Node + ws room server
docs/
```

## Risks

| Risk | Likelihood | Response |
| --- | --- | --- |
| A handedness or drag mistake makes the buggy feel wrong | High at first | Port the buggy alone first, with a test scene and the original constants side by side. |
| Scope: four vehicles, sky, multiplayer and sliders in two days | High | Strict order in the roadmap. The buggy on a volcano with a sky comes first and is worth having alone. |
| Ramming feels soft over the internet | Medium | Tune proxy blend and radius with sliders. Accept it for the weekend. |
| WebGPU differences on iPhone | Medium | Quality tiers and the WebGL fallback from day one. Test on your phone early. |
| Cascaded shadows cost too much on mobile | Medium | One cascade on the mobile tier. |
| Friends cannot reach the server | Depends on hosting | See the open decision below. |

## Open decisions

1. **Where does multiplayer run this weekend?** The preview links I can publish are private
   to your Tailscale network. Friends outside it need public hosting, which needs your
   go ahead and an account, for example Cloudflare or Fly.
2. **Who can move shared sliders?** Everyone, with a host lock, or host only as in the
   original. I recommend everyone.
3. **Google tiles for a private jet flyover.** Fine by the terms for viewing. Using the mesh
   for collision is a grey area that only matters if this goes public. Needs a Google Maps
   API key from you.
4. **Blender.** May I install it to convert your original vehicle models to glTF?

The build order and acceptance checks are in [ROADMAP.md](ROADMAP.md).
