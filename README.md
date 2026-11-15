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

## Built with

Three.js on WebGPU with a WebGL fallback, Rapier physics, TypeScript and Vite. Every world
is generated on your machine from a shared seed, so there is nothing to download.

## Licence

Syn3h is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
you are welcome to play with it, change it, extend it and share what you make, for any
noncommercial purpose. Commercial use needs a licence from Terran Labs; see
[NOTICE.md](NOTICE.md). Third-party components keep their own licences.
