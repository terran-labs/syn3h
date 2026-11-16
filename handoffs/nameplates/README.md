# Vehicle nameplate proposal

Source only. No tests or browser checks have run, and this is not an integration handoff.

The owner prioritized vehicle labels over the parked satellite work. The new module replaces
plain remote tags, adds host-owned bots, and gives people priority over smaller, fainter bots.
It registers a narrowly persisted Interface choice: All, People, Off. Me discovers that choice
through the existing registry. No network messages or replicated fields change.

**The integration seams are already composed in this isolated branch. Do not apply the stored
patch again.** The patch is now a zero-context review artifact of the three minimal seams,
refreshed from the authorized base; the original stale patch remains in prior history. It changes Net's
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
- The historical patch matched the old worktree base; this is not evidence it applies to a current candidate.
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

## Current intake and validation preparation

Read-only comparison used accepted `9ef163a2` and candidate `e945da1c`. The minimal feature
stack is `d00691f9`, `a4186631`, `23add2b2`, followed by the fixture/document correction.
The feature adds only its module, two tests and handoff files. Net and Shell patch contexts
still match both compared targets. The candidate main context does not: its joined-URL
handling moved into LobbyAddress. A future authorized integrator must insert the nameplates
callbacks at the current `startNetworking` call, preserving `initializeFrozenResources`,
LobbyAddress initialization, `showPlay`, history state and resume `entrySearch`. Do not
restore the obsolete joinedUrl/history.replaceState block. No composition is performed here,
and none of this is a prerequisite for the independent current release.

The existing browser fixture is `tests/ui/nameplates.mjs`. It imports a source module through
`/src/`, so it needs an allocated isolated dev server with its own room server, not an
unmodified frozen production directory. The reviewed Net/main/Shell composition is mandatory;
omitting view callbacks intentionally hides all labels. Me still owns the Interface group;
no new Me insertion or shared parameter edit is needed. Current fixed touch controls remain
body siblings, so the sibling exclusion test stays necessary. Full-room fallback uses owned
bots and needs a later ownership/dedup check along with host and follower views.

Fixture controls now use supported `bots.tagBeams=false`, `gfx.auto=false`, `gfx.quality=4`,
`daydream.seconds=0` and `sun.dayLength=0`. Captures reject control drift or an active idle
pilot. No repeated legacy gfx.level write is used. Planet changes may change world parameters;
the fixture fails rather than silently accepting a resumed clock.

Prepared unit cases exercise the actual instance terrain-query guard at 512 calls, reject
unresolved placement when only one required query remains, and give a human the final queries
before a nearer bot. A minimal DOM/observer stub supports construction only; the actual query
guard and placement allocator run unchanged. These tests do not prove the whole renderer's
budget reset or visual depth accuracy; those remain browser acceptance checks.

Cost evidence now samples up to 120 distinct completed label draws within ten seconds for
near labels on, near labels off, and far labels on. It uses the existing internal draw stamp
and entries from the fixture, without a product API or profiling framework. Each window writes
raw samples plus min/median/p95/max query count and drawMs, cap-hit count, submitted human/bot
IDs, visible IDs and missing IDs before asserting completeness and the cap. A timeout is an
incomplete gate, not a shortened passing sample. DOM observation adds harness work; drawMs is
the label module's own CPU measurement, not total frame cost or GPU timing. Off-mode drawMs
is zero by the current runtime's early-return bookkeeping and cannot establish the full cost
of disabling labels.

Missing roster entries are not automatically budget starvation: distance, terrain, HUD and
other labels can legitimately hide them. Review raw near/far samples and cap-hit windows
against known-clear staged positions, report human and bot counts separately, and capture
expected versus visible labels. The current three-person/four-bot fixture is a bounded
starting case, not a maximum-human-density performance claim. Larger crowded human rosters,
repeatable cap pressure and a geometry-matched on/off frame-cost comparison still need an
allocated fixture extension and review. Do not increase the cap or weaken fail-hidden behavior
to obtain green evidence.

After independent source review and explicit allocation, run sequentially in the integrated
worktree through `/Users/vtn/dev/Syn3h/tools/heavy.sh`: `npm run typecheck`,
`npx vitest run tests/ui/nameplates.test.ts --maxWorkers=2`, then the touched UI/net/core suites.
The separate browser allocation runs `node tests/ui/nameplates.mjs` with `SYN3H_URL` pointing
at that worktree's own dev/room servers, followed by the existing network smoke. Record exact
integrated source and logs. No syntax, tests, build, server, browser or capture has run for
these corrections; they require independent review before any gate.

## Isolated composition for independent review

Authorized base: `e945da1c53fe77e8a51896b243e7541b6a2ce10a`. Worktree:
`/tmp/syn3h-nameplates-compose`, branch `integration/lobby-nameplates-1600`.
The original nameplate worktree and candidate/root were not edited. Carried source maps:

| Original feature | Carried commit |
| --- | --- |
| d00691f9 | 1e6e4a39 |
| a4186631 | d9e7560a |
| 23add2b2 | 832f88ce |
| 372d9bdf | 5268f05e |

The only edits to existing product files are the five-line nameplates callback in current
main, the two-line Shell visibility getter, and the reviewed Net imports/context/constructor/roster
adapter. No old joinedUrl code was restored. `initializeFrozenResources` still runs before game
and vehicle creation; LobbyAddress initialization/play restoration, ResumeSession entrySearch,
credits/licences and Back markup remain as on the base. No input, zoom or protocol changes.

Protected blob identities, verified identical to the authorized base:

- `src/core/frozenResources.ts`: `03a39d1dd3e579b686f63460799dcfdcfc2a35e9`
- `src/ui/LobbyAddress.ts`: `005d244ef41efda3ec7b44dc8897842fa185667a`
- `src/core/resume.ts`: `c3cc488a6cd72c1c684fe70cf894e5e61172db0e`
- `src/ui/data/credits.ts`: `827f35380bc9a45348b52df397caf02597167b62`
- `shared/protocol.ts`: `636bc7e537170033e5962cde8f67a7c6c45b2f78`
- `shared/params.ts`: `cec4cc1a57dcaf6dc00e1c8f2f2dbf2f73f7fb5e`
- `src/core/Input.ts`: `189b16736817b248427377f9d2c1c6efacfae02c`
- `src/core/ChaseCamera.ts`: `63787d1b6e88b6cd838ef4fd205be69ca917bb0b`
- `src/ui/TouchControls.ts`: `c87e737488e0a0b99cd17147b39c670e90325b9a`

Only browser-fixture JavaScript syntax and whitespace checks are permitted at this stage.
Typecheck, focused nameplate units, touched UI/net/core checks, full host/follower browser
coverage, curvature/wrap/occlusion captures, 512-query fail-hidden behavior and measured
near/far crowded-human cost remain unverified. The tests deliberately retain their existing
limits and evidence caveats. Independent source review and explicit allocation precede any gate.
