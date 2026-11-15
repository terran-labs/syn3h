# Agent instructions for Syn3h

Engineering principles that apply to every lane. How the lanes work together is in `ops/`.

## Core engineering principle: generate it, do not ship it

Set by the owner on 14 November 2026.

**Procedurally generate everything we can.** When a thing can be generated at run time and
look as good as or better than a prebuilt asset, generate it. The reasons, in his order:

1. **It loads faster.** A shader, a path or a few numbers arrive in the first bundle. A
   bitmap is a separate request and megabytes on a phone.
2. **It is customisable by the player.** Anything generated from parameters can be given a
   seed, a colour or a slider. A baked image can only be swapped for another baked image.
3. **Fewer bitmaps to pre-generate and embed.** Every embedded image is something to
   licence, regenerate at each size and keep in step with the design.

In practice:

- Reach for shaders, vector paths, CSS, synthesised audio and seeded generators before
  textures, sprites, image files and recordings.
- Expose what you generate through the parameter registry (`shared/params.ts`) or plain
  options with a seed, so it can be tuned and shared.
- A generated thing must earn its place: if a small asset genuinely looks or sounds better
  and the generated version cannot match it, say so and keep the asset. Recorded originals
  the owner supplied (music, the laser and wind clips) stay.
- Do not be constrained by how the 2010 and 2017 Unity builds were made. Use current web
  platform features (WebGPU, WebGL 2, modern CSS, Web Audio) to cut load time and raise
  the visual effect. The originals are art direction, not a specification.
- Measure before claiming a win: bytes shipped, time to first frame, frame cost.

Worked examples: the terrain and its roads, the sky and its scattering, vehicle engine
voices (`src/audio/`), the lobby starfield and nebula (`src/ui/Starfield.ts`), the Syn3h
wordmark as one vector path (`src/ui/brand/`), QR codes (`src/ui/QrCode.ts`).
