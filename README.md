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

## How to play

Open [www.syn3h.com](https://www.syn3h.com/) in a recent browser on a computer, tablet or
phone. There is nothing to install and no account.

1. **Pick a world.** The lobby is a small solar system. Drag to look around and tap a
   planet to land on it.
2. **Take the controls.** On a computer, click once to capture the mouse, then drive with
   the keys and look around with the mouse. On a touch screen, steer with your left thumb
   and use the buttons on the right.
3. **Open the panels.** Press Esc to free the mouse and the side panel slides in: game
   mode, players, vehicles, world, sky, performance and your own settings. Click back into
   the world and it slides away.
4. **Change vehicle.** Open Vehicles in the side panel and choose a buggy, jet, hovercraft
   or tank. It swaps where you stand.
5. **Bring a friend.** Share the address in your address bar. Everyone in the same room
   drives in the same world.

In the galaxy, Multiplayer, Settings and About open their panels directly. Use the
other lobby buttons to switch panels, or press Escape, tap Back or tap outside to close.
The galaxy stays on screen while idle.

Press **H** in the game at any time for the controls of the vehicle you are in.

### Keys

**Every vehicle**

| Key | What it does |
|---|---|
| W A S D or the arrow keys | Drive and steer |
| Shift | Brake |
| Space | The vehicle's special: wings on the buggy, hover or flight on the jet, a hop inside the Zorb ball |
| X | Roll inside a Zorb ball, or leave it |
| L, Enter or left click | Use the selected gear (Plasma Tag to start) |
| T | Next gear |
| 1 to 9 | Choose a gear by its place in the rack |
| H or ? | Show or hide the controls |
| J | Show or hide the invite panel with its QR code |
| P | Presentation mode, for a projector |
| Esc | Free the mouse and show the side panel. Press it again to pause |

**Buggy**

| Key | What it does |
|---|---|
| Space | Open or fold the force field wings |
| W and S, with wings open | Pitch down and up |
| A and D, with wings open | Roll |

**Jet**

| Key | What it does |
|---|---|
| E, or R | Hold to lift off and climb. In flight: more thrust |
| Q, or F | Come down. In flight: less thrust |
| W and S | Nose down and up |
| A and D | Bank |
| Space | Switch between hover and flight |

**Hovercraft**

| Key | What it does |
|---|---|
| W | Thrust forward |
| A and D | Turn |
| S | Pitch when Glide assistance is off; with the default assistance, it provides no reverse thrust |

**Gear**

| Gear | How to use it |
|---|---|
| Plasma Tag | Click or press L to tag another vehicle with a streak of plasma |
| Plasma Thunder | Hold until fully charged, then release. Letting go early fizzles |
| Chaser | Aim at a vehicle and press to send a Chaser after it |
| Grapple | Click to launch, hold to reel in, V or the mouse wheel to let out, G to let go |
| Yoink | Aim at a vehicle and hold to grab, release to fling. With no target, press for a gust |

A gamepad works too: the D-pad's left and right switch gear, LB lets the grapple out and RB
lets it go.

### Camera

Press **C** to step through the five camera modes, in this order:

| Mode | What you see |
|---|---|
| Chase | Behind the vehicle, following it. The default |
| Cockpit | From the driver's seat |
| Orbit | Around the vehicle, wherever you point the mouse |
| Stationary | The camera stays where it is and watches the vehicle go |
| Roam | A free camera. W A S D moves it, E and Q raise and lower it, Shift makes it ten times faster. The vehicle's driving keys are off while you roam |

| Key or mouse | What it does |
|---|---|
| C | Next camera mode |
| Right click | Jump to the cockpit, and back to chase |
| Mouse wheel | Move the camera closer or farther; in roam, change the roam speed |
| + and - | Move the chase camera closer or farther |
| Z, held | Scope: zoom in. Turn the wheel while holding Z to change the magnification |
| Middle mouse drag, or Alt and left drag | Look around without capturing the mouse |
| Mouse, once captured | Look around |

### On a phone or tablet

Steer with your left thumb: the stick appears where you touch. The buttons on the right
depend on the vehicle: WINGS on the buggy, THR + and THR - and MODE on the jet, and BRAKE,
TAG and ZORB on all of them. Tap a gear in the selector to switch, and use the Panels
button to open and close the side panel.

### Questions

**Do I need to install anything or sign in?** No. It runs in the browser from one address.

**Which browsers work?** Automated checks run in Chrome and WebKit, including iPad and
phone-sized layouts. Those checks do not replace testing on physical devices. The game
uses WebGPU where available and falls back to WebGL.

**How do I play with other people?** A fresh visit to the plain address defaults to the
room `lobby`, with up to sixteen players. A saved session can restore your previous room.
For a room of your own, open the game with `?room=your-room-name`. Press J to share the
current room through an invite link or QR code; the invite carries its name and world.

**My vehicle started driving by itself.** That is Daydream. After fifteen seconds without
input the vehicle takes itself for a drive. Touch any control and it is yours again.

**It is running slowly.** Open Performance in the side panel and pick a lower quality
level. There are six, from Minimal to Cinematic. With Auto on, the game lowers the level
itself when frames drop, unless you have pinned one by hand.

**How do I change the world?** Open World or Sky in the side panel. Gravity, time of day,
weather, water and a few hundred other settings are live sliders, and in a shared room
everyone feels the change.

**What are the bots doing?** They follow you around by default and do not use gear. Each
has its own personality and picks its own route.

**Can I play an older version?** Accepted releases are kept; withdrawn builds may be unavailable. Add `?v=` and the version to
the address, for example
[www.syn3h.com/?v=26.11.1503](https://www.syn3h.com/?v=26.11.1503). The
[releases page](https://github.com/terran-labs/syn3h/releases) lists them, each with its
playable link.

**Can I use the code?** Yes, for anything noncommercial. See [Licence](#licence).

## Run it

```sh
npm install
npm run dev
```

Open the address it prints. The room server starts alongside it, so a second tab is a
second player.

## How it is made

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-lobby.jpg" alt="The galaxy lobby: nine labelled planets on their orbits around a sun" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-alpine.jpg" alt="The buggy on a green meadow under grey granite peaks on the Alpine world" width="420">

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

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-night.jpg" alt="The buggy on the Ice Moon at night, its headlights lighting the ice under a violet sky" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1508/lava-night.png" alt="A buggy at the shore of a glowing lava sea at night, a volcano on the horizon" width="420">

**Light that agrees with itself.** The sky is physical scattering, evaluated twice: once in
the shader that draws it and once in plain code that colours the sun, the ambient light and
the fog with the same terms. The picture is then finished in one pipeline written in
three.js shading nodes: glow, sun shafts the volcano can eclipse, ambient occlusion,
screen-space global illumination, soft contact shadows, raymarched clouds that drift with
the wind, temporal antialiasing, and a colour grade for each planet. It runs on WebGPU and
falls back to WebGL.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-swells.jpg" alt="The hovercraft afloat on a rolling blue swell" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-underwater.jpg" alt="The buggy sinking toward a sandy seabed, seen from under the surface" width="420">

**Water that carries you.** The sea is a short sum of swells with one formula, written once
for the physics and once for the shader. A floating vehicle rises on exactly the wave you
see, using a shared room clock to keep the swells aligned. The same habit runs through the
project: waves, wrapping, sky maths and the parameter registry are single shared
definitions read by the game, the room server and the tests, which keeps what you see,
what you collide with and what the other player sees consistent.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-wings-glide.jpg" alt="The buggy gliding on its hexagonal force-field wings over desert dunes" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-jet-plume.jpg" alt="The jet in forward flight past desert buttes, thrust plumes streaming behind" width="420">

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-zorb.jpg" alt="The buggy rolling inside a translucent Zorb ball on the dunes" width="420"> <img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-lineup.jpg" alt="The jet, hovercraft, buggy and tank parked together on the desert" width="420">

**Machines with opinions.** Rapier runs the physics at a fixed step, in its own compiled
file that loads beside the lobby. A buggy that opens force-field wings and glides, a jet
that hovers and flies, a hovercraft, a tank, and a Zorb ball any of them can roll inside.
Switch between them in place, without leaving the world. Everything is a parameter:
gravity, drag, buoyancy and some three hundred others are live sliders, change one and the
whole room feels it, and a world's settings travel in its link.

**Music nobody recorded.** A seeded composer writes the score a sixteenth note at a time
from what you are doing, and a synthesiser built from Web Audio worklets plays it: pads,
choir, plucks, bells, a hall. Engines, wind and impacts are synthesised too.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-company.jpg" alt="Bots in a hovercraft, two buggies and a jet closing in on the player across the desert" width="420">

**Company.** Bots have a mind that picks a purpose by seeded personality, a navigator that
plans a route their kind of vehicle can travel, and a pilot that works the same controls
you do. Leave the keys alone and the same three layers drive your own vehicle on a tour.

<img src="https://github.com/terran-labs/syn3h/releases/download/v26.11.1512/readme-multiplayer-qr.jpg" alt="The Multiplayer panel with the QR code the game draws for its room" width="420">

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
