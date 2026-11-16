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
- A generated thing must earn its place. Measure visual and audio quality as well as cost.
  Preserve supplied originals as source material; retaining a file does not authorize a
  runtime request. The later owner direction prohibits ordinary-play binary asset loading,
  subject to accepted exceptions such as the permitted vehicle meshes. Curated About images
  may load only after deliberate About entry, with zero image requests before that action.
  Lazy loading alone does not satisfy this exception.
- Use current web platform features (WebGPU, WebGL 2, modern CSS, Web Audio) to cut
  load time and improve visual quality. Choose implementation techniques for this
  browser experience and measure their results.
- Measure before claiming a win: bytes shipped, time to first frame, frame cost.

Worked examples: the terrain and its roads, the sky and its scattering, vehicle engine
voices (`src/audio/`), the lobby starfield and nebula (`src/ui/Starfield.ts`), the Syn3h
wordmark as one vector path (`src/ui/brand/`), QR codes (`src/ui/QrCode.ts`).
