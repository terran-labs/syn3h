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
   (`npx tsx tools/handling-report.ts`) and the release notes, where a surprising change
   is visible without stopping a release.
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


## Game principle: nothing but physics moves a player for where they drove

Set by the owner on 18 November 2026, after the game set his buggy upright in a lava pool
he had fallen into on v26.11.1802: "This is a non-violent game. There is no death... It's
about exploration."

**The game never moves, resets or respawns a player's vehicle as a consequence of where
they drove.** Lava, deep water, a fall, being stuck or lying upside down are places to be
and to get out of, not failures the game repairs. In practice:

- Lava and water slow, float, sink and heat a vehicle by physics. Nothing teleports a
  player out, and every vehicle can leave a pool under its own power (a jet's lift climbs
  through lava; a capsized buggy floats back onto its wheels). King of the Hill counts a player in lava as off the hill until they drive
  out; it never sends them to their pad.
- Automatic uprighting (`Vehicle.uprightRescue`) never fires in or over lava or water. On
  dry ground it stays, pending the owner's decision.
- The player's own controls are allowed to move them: Flip upright (the U key, and FLIP in
  BRAKE's place on touch, both offered only while it can act), and the Zorb. So is in-fiction help by physics: bots that tow a stuck player out
  with a cord, and the player's own grapple (the rescue rework the owner approved on
  17 November 2026).
- A reload resumes the saved pose, in liquid too. A rebuild of the same world re-seats the
  vehicle where it is, on the ground or the liquid's surface, whichever is higher. Only
  entering a different world starts at a spawn pad.
- The nets that remain (falling below the world, a non-finite position, tunnelling under the
  ground) are for broken states only. Each one firing is a bug: it is logged to the console
  and the room server's log (`src/core/rescueLog.ts`).
- Bots may hop themselves back to a pad; a bot hop never applies to a vehicle a person drives.

`tests/vehicles2/no-reset.test.ts` holds this: every vehicle held in deep lava and deep water
for a minute, and a buggy on its roof in shallow lava and water, is moved by nothing but
physics; and every vehicle leaves a lava or water pool from its surface and its bed within the
pool's radius at walking pace.
