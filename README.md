# Syn3h

Off-road sci-fi vehicles on procedural volcanic islands, with multiplayer, running native in
the browser.

Drive a buggy with force field wings, a jet or a hovercraft up a volcano, ram your friends
into the lava, and change the world's gravity, sky and physics while you play.

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
| Fire | L or click |
| Camera | C |
| Help | H |

## Built with

Three.js on WebGPU with a WebGL fallback, Rapier physics, TypeScript and Vite. Every world
is generated on your machine from a shared seed, so there is nothing to download.
