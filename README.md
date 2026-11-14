# Syn3h

A browser native rebuild of [Mars Explorer](https://github.com/terran-labs/unity3d-marsxplr)
and its successor Syn3h: off road sci fi vehicles, procedural alien skies, and multiplayer
with every physical and environmental parameter exposed as a shared slider. No Unity. Built
on WebGPU with a WebGL fallback.

Status: planning. No game code yet.

## Documents

| Document | What it covers |
| --- | --- |
| [docs/PROPOSAL.md](docs/PROPOSAL.md) | The recommended stack and design: rendering, physics, sky, terrain, multiplayer, sliders, risks, open decisions |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Build order with acceptance checks, for the first weekend and after |
| [docs/architecture/mars-explorer.md](docs/architecture/mars-explorer.md) | How the original game works, with the vehicle physics and netcode read from source |
| [docs/architecture/syn3h.md](docs/architecture/syn3h.md) | What the Unity version of Syn3h was built from and what carries over |
| [docs/research/reference-games.md](docs/research/reference-games.md) | The stacks behind bruno-simon.com and Teleoperator |
| [docs/research/real-world-cities.md](docs/research/real-world-cities.md) | Options for streamed real world cities and terrain |

## The short version

- Three.js `WebGPURenderer` with TSL shaders.
- Rapier for rigid bodies and raycasts, with vehicle forces ported from the original
  Mars Explorer scripts.
- Owner authoritative multiplayer over a small WebSocket room server, with nearby remote
  vehicles kept physical so they can be rammed.
- One parameter registry that drives the UI, the network sync and saved presets.
