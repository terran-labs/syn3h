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

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/lobby.png" alt="The galaxy lobby: nine planets on their orbits around a sun, each labelled" width="420">

**A world from a number.** Each planet is generated from a seed and shared settings:
terraced ground, chains of cellular mountains, volcanic islands with lava lakes,
and roads laid over what the terrain allows. No terrain model needs downloading. Your machine
grows the same world as everyone else's in the room, and the globe you tap in the lobby is
painted from that very island, so the preview is the place. Terrain, sky, water, clouds,
plants, sound and music all come from code at run time. What the game still downloads is
its scripts, the physics engine, one interface font and the Buggy's model; the jet, the
hovercraft and the tank are generated too.

**A world without an edge.** The map is a tile that repeats exactly. Drive off one side and
you arrive on the other. Cameras, bots, the minimap, the network and even the motion
vectors of the antialiasing account for wrapping to keep the crossing continuous.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/lava-night.png" alt="A buggy at the shore of a glowing lava sea at night, a volcano on the horizon" width="420">

**Light that agrees with itself.** The sky is physical scattering, evaluated twice: once in
the shader that draws it and once in plain code that colours the sun, the ambient light and
the fog with the same terms. The picture is then finished in one pipeline written in
three.js shading nodes: glow, sun shafts the volcano can eclipse, ambient occlusion,
screen-space global illumination, soft contact shadows, raymarched clouds that drift with
the wind, temporal antialiasing, and a colour grade for each planet. It runs on WebGPU and
falls back to WebGL.

**Water that carries you.** The sea is a short sum of swells with one formula, written once
for the physics and once for the shader. A floating vehicle rises on exactly the wave you
see, using a shared room clock to keep the swells aligned. The same habit runs through the
project: waves, wrapping, sky maths and the parameter registry are single shared
definitions read by the game, the room server and the tests, which keeps what you see,
what you collide with and what the other player sees consistent.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/wings-glide.png" alt="The buggy gliding on its hexagonal force-field wings above the dunes" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/jet-flight.png" alt="The jet climbing over the volcano at 229 metres" width="420">

**Machines with opinions.** Rapier runs the physics at a fixed step, in its own compiled
file that loads beside the lobby. A buggy that opens force-field wings and glides, a jet
that hovers and flies, a hovercraft, a tank, and a Zorb ball any of them can roll inside.
Switch between them in place, without leaving the world. Everything is a parameter:
gravity, drag, buoyancy and some three hundred others are live sliders, change one and the
whole room feels it, and a world's settings travel in its link.

**Music nobody recorded.** A seeded composer writes the score a sixteenth note at a time
from what you are doing, and a synthesiser built from Web Audio worklets plays it: pads,
choir, plucks, bells, a hall. Engines, wind and impacts are synthesised too.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/bots-pursuit.png" alt="Three bots in different vehicles trailing the player across a red plain" width="420">

**Company.** Bots have a mind that picks a purpose by seeded personality, a navigator that
plans a route their kind of vehicle can travel, and a pilot that works the same controls
you do. Leave the keys alone and the same three layers drive your own vehicle on a tour.

**A room that sleeps.** One Cloudflare Worker serves the game and gives each room its own
Durable Object. WebSocket hibernation lets the room stop running code while idle and retain
its connections. A phone joins by a QR code the game draws itself.

**Every version stays playable.** Each release is frozen and kept:
[www.syn3h.com/?v=26.11.1503](https://www.syn3h.com/?v=26.11.1503) will serve that build
exactly, however many follow it.

**Built in a weekend.** One person directed a team of AI agents, each with its own lane,
tests and browser checks, releasing to production through the night and the day after.

Three.js, Rapier, TypeScript and Vite. No game engine.

## Licence

Syn3h is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
you are welcome to play with it, change it, extend it and share what you make, for any
noncommercial purpose. Commercial use needs a licence from Terran Labs; see
[NOTICE.md](NOTICE.md). Third-party components keep their own licences.
