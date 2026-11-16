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
- The running game loads no binary assets: no recorded audio, images, textures or models
  fetched or decoded at run time, and no fonts beyond the approved one. The owner's rule of 15 November 2026: "Binary
  assets in the codebase are okay. Binary assets that get loaded into the running game are
  unacceptable." It withdraws the earlier exception for his recorded originals: music, cues
  and wind are synthesised, and the generated score is the only music.
- Binaries the game itself never loads may live in the repository: install icons and the
  link-preview card (fetched by the browser, the phone and crawlers), source art, captures.
- If a generated version cannot yet match an asset, say so to the owner and get his
  decision; do not quietly keep the asset. Anything he accepts goes on the release check's
  approved list. Today that is the Barlow interface font, trimmed to the weights used
  (a standing exception), and the vehicle models still loaded for the noon release, to be
  replaced by generated vehicles after the demo.
- Do not be constrained by how the 2010 and 2017 Unity builds were made. Use current web
  platform features (WebGPU, WebGL 2, modern CSS, Web Audio) to cut load time and raise
  the visual effect. The originals are art direction, not a specification.
- Measure before claiming a win: bytes shipped, time to first frame, frame cost.

Worked examples: the terrain and its roads, the sky and its scattering, vehicle engine
voices (`src/audio/`), the lobby starfield and nebula (`src/ui/Starfield.ts`), the Syn3h
wordmark as one vector path (`src/ui/brand/`), QR codes (`src/ui/QrCode.ts`).

## Testing principle: test what must stay true, report what is tuned

Set by the owner on 16 November 2026, after a night in which checking the checks took
longer than shipping the game.

**A test earns its place only if its failure means a player would hit a bug.** A test
that fails because someone improved the game is a cost, and we stop paying it.

1. **Invariants block releases.** A vehicle rests upright, does not fall through the
   ground, never produces a non-finite value, can move under input, and survives a
   network round trip. Saves load. Modes follow their rules. These live in `tests/` and
   the suite must be green: a failing test is fixed or deleted the same day, never
   carried as a "known failure".
2. **Tuning does not.** Top speed, acceleration, jump distance, turn radius, drift and
   anything else the owner adjusts by feel must not be pinned to a number in a blocking
   test. A test may assert a number only when the owner would call a change to that
   number a bug. Where a threshold is needed, derive it from the parameter registry
   (`shared/params.ts`) so retuning moves the expectation with it.
3. **Handling is reported.** Measured handling per vehicle goes into the handling report
   (`tools/handling-report.mjs`, being added) and the release notes, where a surprising change is
   visible without stopping a release.
4. **Validation scales with risk.**
   - Interface, copy, styling: typecheck, the affected tests, one look in a browser at
     phone and desktop size.
   - Physics, bots, world generation: the above plus the full suite.
   - Networking and the room server: the above plus the two-player smoke test.
   - A production release: `tools/release.sh`, which freezes, deploys, checks the public
     address and rolls back on failure. Nothing else is required.
5. **Run the test; do not package it.** Unit tests and typechecks run directly through
   `tools/heavy.sh`. No bespoke runners, hash pins, receipts or process-closure audits
   around a test that finishes in seconds. If a check needs its own harness, the harness
   is the smell.
6. **One review, of the change.** Review the diff and its result once. Do not review
   test runners, evidence files or another agent's review.
7. **Two failed runs, then fix the product or the test.** Do not gather more
   measurements of a failure that is already understood.
8. **Delete freely.** Before adding a test, name the bug it would catch. When a test
   has needed editing in most changes to its subject, rewrite it as an invariant or
   remove it. Slow tests (over ten seconds) need a reason to be in the blocking suite.

