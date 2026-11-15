# Syn3h

Off-road sci-fi vehicles on procedural volcanic islands, with multiplayer, running native in
the browser.

Drive a buggy with force field wings, a jet or a hovercraft up a volcano, tag your friends
with a beam or a nudge, and change the world's gravity, sky and physics while you play.

**Play it now at [www.syn3h.com](https://www.syn3h.com/).**

![Scenes from the latest Syn3h release: the galaxy lobby, the buggy and volcano, wings in a glide, the jet above the island, and lava at night](https://github.com/terran-labs/syn3h/releases/latest/download/syn3h-showcase.gif)

The animation is captured from each production release and follows the latest one. Notes
and screenshots for every release are on the
[releases page](https://github.com/terran-labs/syn3h/releases).

## Run it

```sh
npm install
npm run dev
```

Open the address it prints. The room server starts alongside it, so a second tab is a
second player.

## Controls

| | |
|---|---|
| Drive | W A S D or arrows |
| Wings, or hover and flight on the jet | Space |
| Brake | Shift |
| Tag beam | L or click |
| Camera | C |
| Help | H |

## How it is made

**A world from a number.** Each planet is generated from a seed and shared settings:
terraced ground, chains of cellular mountains, volcanic islands with lava lakes,
and roads laid over what the terrain allows. No terrain model needs downloading. Your machine
grows the same world as everyone else's in the room, and the globe you tap in the lobby is
painted from that very island, so the preview is the place.

**A world without an edge.** The map is a tile that repeats exactly. Drive off one side and
you arrive on the other. Cameras, bots, the minimap, the network and even the motion
vectors of the antialiasing account for wrapping to keep the crossing continuous.

**Light that agrees with itself.** The sky is physical scattering, evaluated twice: once in
the shader that draws it and once in plain code that colours the sun, the ambient light and
the fog with the same terms. The picture is then finished in one pipeline written in
three.js shading nodes: glow, sun shafts the volcano can eclipse, ambient occlusion,
screen-space global illumination, soft contact shadows, raymarched clouds that drift with
the wind, temporal antialiasing, and a colour grade for each planet. It runs on WebGPU and
falls back to WebGL.

**Water that carries you.** The sea is a short sum of swells with one formula, written once
for the physics and once for the shader. A floating vehicle rises on exactly the wave you
see, using a shared room clock to keep the swells aligned.

**Machines with opinions.** Rapier runs the physics at a fixed step, in its own compiled
file that loads beside the lobby. A buggy that opens force-field wings and glides, a jet
that hovers and flies, a hovercraft, a tank, and a Zorb ball any of them can roll inside.
Switch between them in place, without leaving the world. Gravity, drag, buoyancy and some
three hundred other parameters are live: change one and the whole room feels it.

**Music nobody recorded.** A seeded composer writes the score a sixteenth note at a time
from what you are doing, and a synthesiser built from Web Audio worklets plays it: pads,
choir, plucks, bells, a hall. Engines, wind and impacts are synthesised too.

**Company.** Bots have a mind that picks a purpose by seeded personality, a navigator that
plans a route their kind of vehicle can travel, and a pilot that works the same controls
you do. Leave the keys alone and the same three layers drive your own vehicle on a tour.

**A room that sleeps.** One Cloudflare Worker serves the game and gives each room its own
Durable Object. WebSocket hibernation lets the room stop running code while idle and retain
its connections. A phone joins by a QR code the game draws itself.

**Every version stays playable.** Each release is frozen and kept:
[www.syn3h.com/?v=26.11.1503](https://www.syn3h.com/?v=26.11.1503) will serve that build
exactly, however many follow it.

### What is unusual about it

- **It generates much of its world at run time.** Terrain, sky, water, clouds, plants,
  sound and music come from code. The game still downloads its scripts, physics WebAssembly,
  interface font and some vehicle models; procedural generation reduces the asset library.
- **One definition, three readers.** Waves, wrapping, sky maths and the parameter registry
  use shared definitions and tests to keep rendering, physics and multiplayer consistent.
- **Everything is a parameter.** Worlds, vehicles and effects are tuned from a registry
  with sliders, and a world's settings travel in its link.
- **It was built in a weekend** by one person directing a team of AI agents, each with its
  own lane, tests and browser checks, releasing to production through the night.

Three.js, Rapier, TypeScript and Vite. No game engine.

## Licence

Syn3h is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
you are welcome to play with it, change it, extend it and share what you make, for any
noncommercial purpose. Commercial use needs a licence from Terran Labs; see
[NOTICE.md](NOTICE.md). Third-party components keep their own licences.
