# Vehicle nameplate proposal

Source only. No tests or browser checks have run, and this is not an integration handoff.

The owner prioritized vehicle labels over the parked satellite work. The new module replaces
plain remote tags, adds host-owned bots, and gives people priority over smaller, fainter bots.
It registers a narrowly persisted Interface choice: All, People, Off. Me discovers that choice
through the existing registry. No network messages or replicated fields change.

Apply `integration.patch` only after its owning lanes accept it. The patch changes Net's
existing roster adapter, passes view state from main, and proposes one Shell visibility getter.
It does not edit Game, vehicle interpolation, camera ordering or TouchControls. Omitting the
new optional view callbacks intentionally hides labels; normal main composition is required.
The old NameTags module becomes unused and can be removed separately once consumers are checked.

## Rendering contract

Net still refreshes text at its existing cadence. Its per-frame update queues the current list;
the existing Scene.onBeforeRender hook reads interpolated positions with the final camera pose.
The hook chains its predecessor, resolves the current camera at draw time, ignores other cameras,
draws once per queued frame and restores its predecessor on disposal without removing a later owner. This includes dynamically appended and swapped remote vehicles.

Project actual rendered world positions. Do not rewrap them relative to the camera: remotes
already choose their tile relative to the player. Centers, raised anchors and occluding hull bounds use the existing CPU curve mapping with a
snapshot of the current render bend. Physics coordinates stay separate. Visual sight lines are
inverse-mapped into curved paths through flat physics space, subdivided into chords, then split
at tile boundaries for the existing terrain-only query. The existing horizon test culls worlds
behind the planet before these queries. Vehicle occlusion uses conservative screen
circles, including the local hull. Zorb labels account for the rotated ball offset and radius.

A pooled DOM layer inherits Halo ink, hairlines and Barlow. Fixed plate dimensions avoid name
measurements; long text is ellipsized. Human text scale stays readable with distance; bots use
66 percent scale, reduced opacity, a BOT note, and become ticks before disappearing. Presentation
increases both by 25 percent. The layer never accepts pointer input.

HUD reads are batched before plate writes. Shell HUD nodes and body-owned touch controls are
both covered. Label mutations do not invalidate the HUD node cache. Labels remain beside the
sidebar but disappear for lobby, pause, invite and exit overlays. Labels and their leaders
reserve screen rectangles; humans allocate first, then nearer labels, with previous-side retention.

## Review and validation remaining

- Multiplayer approved identity, host/bot enumeration and color plumbing by source review.
  Its camera-relative wrapping finding was fixed; a half-world camera regression was added.
- UX approved preference and theme seams by source review. Its sibling-touch exclusion finding
  was fixed; composition now uses shell.element and a separate visibility getter approved by UX at source level.
- The prepared integration patch passes git apply --check against the worktree base.
- Unit and typecheck runs await an explicit testing slot. No passing result is claimed.
- Browser acceptance must exercise two other people and several bots, host and follower, normal
  and presentation views, sidebar/touch exclusions, Zorb and materialization, wrap seams and all
  camera modes. Capture near/far, bright sky/snow and night on desktop and portrait phone.
- Measure frame cost with the layer on/off in the same fixture. Terrain rays and HUD reads are
  the likely costs; the gate records per-frame query count and label CPU time; no performance claim is justified before that measurement.
- Keep the existing network smoke's name-tag visibility assertion compatible. The new layer
  retains the syn3h-nametags class; don't loosen gameplay timing assertions to validate labels.

The first draft uses conservative hull radii (6 m Jet, 3.5 m other vehicles, enlarged by Zorb).
Review captures for excess label height and over-culling. Curved visibility subdivides when inverse-path midpoint error exceeds 0.10 m or the visual
segment exceeds 32 m. It hides unresolved rays after 128 segments. A shared 512-query budget
per frame is allocated to people first, then bots; unresolved labels stay hidden rather than
running unbounded physics work. Plate visibility samples six edge points, not every pixel.
Narrow terrain between chords or unsampled plate pixels may escape detection, and rough hull
bounds can hide more labels than necessary. This is not exact visual depth or a GPU depth mask. Bright-world contrast,
label density, scan timing and actual frame cost remain visual acceptance items.

## Curvature review correction

The first draft projected flat coordinates and was rejected because default curved planets bend
all vehicle vertices. The correction retains actual rendered tile identity, maps every center,
anchor and hull sample through curveOffsetAt using copyCurveState, and inverse-maps visibility
queries rather than feeding bent points to flat physics. Focused tests cover flat, default and
maximum curvature, distant anchors, horizon interception and whole-tile translations. The
prepared browser fixture now has an observer plus two remote people, explicit human/bot size
and opacity assertions, and near/far curved-world captures on desktop and phone. All remain
unrun under the testing hold.
