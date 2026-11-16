# About editorial handoff

Draft for UX integration and factual review. Existing licences remain intact. Sections
below are public copy; delivery notes at the end are not interface text.

## Explore together

Drive to the rim of a volcano. Unfold your buggy's force-field wings and leave the road
behind. Bring a friend, pick a distant ridge, and see what happens on the way there.

Syn3h is a shared sci-fi playground for driving, flying and exploring strange worlds.
Take a buggy, jet, hovercraft or tank into the landscape. Play Tag, hold a hill, experiment
with gravity, or park together and watch the light change.

Explore is the default. You can take your time. Finding a route, attempting an absurd
jump and enjoying someone's company are all good reasons to be here.

## Your first expedition

Choose a planet in the galaxy. On a computer, click into the world to look around, use
WASD or the arrow keys to drive, and press H for your vehicle's controls. On a phone or
tablet, use the thumbstick and the on-screen action buttons.

Open the panels to change vehicle, choose a game mode or adjust the world. Escape frees
the mouse on a computer. Vehicles change where you stand, so try the same journey by
ground, water and air. Press J for an invitation and QR code, or share your room's link.

Start with the shoreline. Find a route to the summit. Open the buggy's wings at a crest,
or press X to roll inside a Zorb. Choose Grapple from the gear rack to try a tether:
click to launch, hold to reel in, and press G to release. The controls panel explains the
rest of your gear. Give each experiment enough space to become a good story.

## Play your way

**Explore.** Roam and experiment together, with no score, hill or player marked as it.
Gear remains available as toys.

**Tag.** A chase across the landscape. Pass the tag along using the room's chosen tag
settings, and use your vehicle's abilities to find an escape route.

**King of the Hill.** Reach the marked zone and hold it alone to score. More than one
vehicle in the zone makes it contested, and scoring pauses until someone gains control.

Choose the mode in the Game panel. You can return to Explore when the room wants to wander.

## The story

Aubrey Falconer's Mars Explorer brought flying cars, volcanoes and laser tag together.
People stayed to explore and create together, and a community grew around those shared
worlds. Syn3h carries that invitation forward: arrive somewhere unfamiliar, learn what
your machine can do, and make your own reasons to stay.

The vision is a place for unhurried exploration and playful engineering. A mountain can
be a destination, a launch ramp or somewhere to watch the weather with a friend. You
choose what the evening is for.

## Under the surface

**Worlds from seeds.** Terrain is generated from a seed and shared settings. The map
wraps, so crossing an edge brings you around the world. A curved rendering gives the
landscape its horizon while the simulation works in its own coordinates.

**Light and water.** Atmospheric scattering shapes the sky. Waves have matching visual
and physics calculations, with a shared room clock to align them. Rendering quality
levels choose which effects your device runs.

**Machines and motion.** Rapier advances the physics at a fixed simulation step.
Vehicle controls, gravity and buoyancy turn that motion into different ways of exploring.
Three.js draws the world through WebGPU or the WebGL fallback.

**A score made as you go.** A seeded composer writes notes for synthesized instruments.
Web Audio produces the music, engines and effects. The soundtrack can respond to the
journey rather than repeating a recording.

**Shared space.** A room service exchanges player and world state. Join the same room to
explore together. The source is available under the PolyForm Noncommercial licence;
commercial use requires permission from Terran Labs.

## Links and credits

- Aubrey Falconer: https://aubreyfalconer.com/
- Source and development: https://github.com/terran-labs/syn3h
- Release history: https://github.com/terran-labs/syn3h/releases

Preserve the existing complete licence disclosure below these links.

## Delivery notes, not public copy

- Source base: accepted release 1516. Mode semantics checked in shared/protocol.ts.
  Control reference is the current README; UX must verify against the integrated controls
  and use current panel names. Do not promise sidebar placement from an older build.
- Historical context comes from the owner's original Syn3h backstory, previously read
  at www.syn3h.com/backstory.html. Freed and Terran Labs writing informs the emphasis on
  chosen attention and agency; no quotations, statistics or future promises are reused.
- The requested third domain remains unconfirmed. Do not invent a replacement.
- Buggy-to-jet towing is requested showcase material. Add its practical recipe only
  after a real multiplayer capture proves the current controls and behavior.
- Dramatic sunrise rays are unfinished. Do not caption an image as proof of the fix
  until the accepted source produces the reviewed capture.
- Curated image URLs are pending. Do not use placeholders that make network requests.
  Hydrate real image sources only after deliberate About opening, including in-game
  entry; check the complete request timeline, not merely loading attributes.
- Use a few images between sections, not a gallery wall. Pair each with descriptive
  alt text and recorded build provenance. Portal and construction proposals are future
  ideas, not current gameplay instructions.

## Editorial review

The draft separates the invitation, practical guide, modes, history and technical detail.
Existing controls and licence text stay available. Claims of universal release retention
and absence of an engine were narrowed in README. Reviewed against the no-ai-slop
checklist for unsupported claims, empty contrasts, repeated rhythm and decorative endings.
