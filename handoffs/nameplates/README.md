# Vehicle nameplate proposal

Product composition passed typecheck and all 40 focused unit tests on `ff8fed28`. Browser preparation below remains unrun and is not release acceptance.

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


## Allocated browser proposal, source only

The standalone fallback port and fixed output directory are removed. The fixture now requires
an exact source SHA, explicit origin, fresh external evidence directory and owned-server launch
manifest. The external proposal is `/tmp/nameplates-current-launcher/run.py`, adapted from
`/tmp/ux-about-input-current-launcher/run-02.py`. Its diff and source/dependency pins sit beside
it. Do not execute until independent review and a runtime allocation. Use the absolute heavy
helper, explicit installed Node executable and proposed fresh evidence path
`/tmp/nameplates-current-browser-001`. No install or alternate config is permitted.

The supervisor retains the reviewed environment whitelist, dotenv rejection, explicit Vite
and room ownership, ports 5331/54671, read-only 8787 observation, PID/start-time cleanup and
590-second total limit. The fixture has 450 seconds for work and 30 for cleanup inside its
480-second allowance. Three fresh contexts open sequentially in one Chrome browser. All
existing host, two-human, bot-size, visibility, curvature, camera, phone, snow and cost assertions
remain. A timeout or missing case fails the gate; this is not permission to omit slow cases.
Host and follower roles are asserted, with follower label IDs checked for duplicates. This
still does not prove follower bot visibility in every camera or maximum-roster performance.

Actual browser document and source responses are captured, compared with isolated served
bytes, and TypeScript source maps tied to checkout content. Raw index uses `?raw&import`.
Each context records its same-origin room socket; the supervisor independently proves that
proxy target belongs to its explicit room process. Cache/service-worker and HMR activity,
page errors, console errors, failed relevant requests and renderer crashes fail the receipt.
Response jobs and partial receipts are bounded, with a final stable response drain through
browser disconnect. No GPU-clean or whole-frame-cost claim follows from these checks.

The existing 120-draw distributions and 512-query assertions are unchanged. Their label CPU
measurements exclude total rendering/GPU cost; off-mode bookkeeping is not a baseline proof.
Real wrap-seam, larger human rosters, controlled cap starvation, modal coverage and hardware
remain open. No syntax, test, typecheck, server, port probe, browser or network operation ran
for this preparation. Earlier sections describing tests as unrun are historical source-stage
notes; only the focused pure gate has since passed. Broader suites require separate allocation.


## Browser 001 source correction

Failed run 001 remains unchanged. The first near view had four bot ticks and no human labels;
its 224 terrain queries do not establish budget exhaustion. Final request drains also failed
on each page's module-worker request. These are separate unresolved causes.

The fixture now saves actual roster/tag entries, rendered remote positions, camera matrices,
cinematic target, bend state, projected and bent anchors, candidate/disc/sight state, HUD boxes,
terrain-budget counters and bounded actual terrain query outcomes before assertions. Terrain
observation calls the original function once and restores it on teardown and before cost
windows. It does not rerun visibility rays, change the budget or override rejection. Cached
plate fields carry draw/sight stamps; stale fields must not be interpreted as current decisions.
No exact allocator rejection reason is claimed for skipped HUD/disc/viewport candidates.

Near-stage positions are closer. A bounded settling predicate requires both named humans,
matching world seed/kind across clients, stable actor/camera positions, convergence to the
requested cinematic pose/FOV, all four bot centers under 95 m and near humans under 140 m.
The original full-label, human visibility, opacity, overlap and cost assertions remain.
Terrain camera clamping can still make this stage fail; no assertion is relaxed to accept it.
The closer stage is source-prepared, not proof that terrain/HUD admits all labels. Stage
failure persists diagnostics without replacing its original error. All time remains inside
the original fixture and supervisor budgets; added checks may consume that budget.

Page and context events now record bounded shared Request identities, response/terminal
outcomes, worker create/close, page-CDP request/loading and target discovery events. Target
discovery does not pause workers or replace Playwright auto-attachment. Page-CDP observations
do not prove child-session network delivery. No worker request is excluded or blindly cleared,
and no new terminal reconciliation is implemented: missing completion/body remains a failure.
Lifecycle overflow fails explicitly. Actual worker body/source-map and terminal coverage still
need runtime evidence before any reconciliation can be justified. All browser coverage and
this correction's syntax remain unrun pending review and allocation.


## Browser 003 source proposal

Near humans now use central x offsets of eight metres and the same front-row depth. Far
positions retain their previous offsets. The positive capture computes all four allocator
plate-plus-leader bounds from current curved candidates, records their HUD intersections,
and requires an actual viewport/HUD-clear slot per human before the original visible-name
and full-bot assertions. This precondition does not override hull or terrain rejection.
The original overlap offsets are retained as a separate negative stage: all human slots
must intersect visible HUD and both human labels must be hidden. Returning to the positive
stage must restore both names. No HUD is hidden, no exclusions or product code change.

Entry omits autoplay and waits in the genuine lobby for the actual matching worker response
body, source-map input matching checkout, and page requestfinished for the same Request ID.
Target destruction without body or terminal evidence receives a distinct failure verdict;
it never clears the pending request or satisfies provenance. The wait is capped at twenty
seconds per client inside the unchanged global deadline. Only then does a native click on
the ordinary Enter World button invoke normal play. A missing or inaccessible button fails;
there is no force-click, scripted play fallback or alternate entry path. Existing source-map
proof now explicitly includes the worker_file response rather than only ordinary modules.

Autoplay closing the lobby and terminating its worker remains a source-supported hypothesis
for the historical failures, not a proven cause. The preserved runs do not gain retrospective
acceptance. Worker source-map shape, terminal delivery, native entry/descent and central-stage
hull/terrain clearance are all unrun. The negative stage adds work within the same budget;
a timeout remains a failure, not grounds to shorten cost sampling or omit later cases.
Only the fixture and this note change. Versioned external launcher pins are refreshed after
commit; previous launcher versions and both failed receipt trees remain untouched.


## Native-entry review correction

The previous Enter World target belongs to a hidden Explore panel on the lobby index.
After the unchanged worker proof, use the established visible current galaxy label instead:
verify its data-world against the actual current planet, focus it, and send native Enter.
Wait for connected play with descent finished. Record and assert world, seed and player name
before/after, plus the actual allocated-room WebSocket. No private entry call, force click,
HUD change or alternate panel navigation is added. Worker-map semantics remain under review;
all prior failure receipts and source versions are preserved. This correction is unrun.


## Lobby-address assertion correction

LobbyAddress intentionally clears visible search/hash in showLobby while retaining the entry
URL. Shell reads its room before that cleanup. Main's join calls showPlay before networking,
and Net's name resolver gives the restored query name priority over Shell's preferred name.
The fixture now records the intended navigation URL/name from its own inputs, asserts the
clean visible lobby URL and Shell's retained room, then uses the same native current-label
entry. After descent it verifies world/seed, restored URL room/name, local roster name and
the allocated-room WebSocket. It neither compares Shell's name to the query nor injects
storage, mutates private state or adds navigation. Worker proof and HUD assertions are unchanged.
Run 004's first-client worker proof and zero-label failure remain preserved. This correction
receives syntax and whitespace checks only; browser validation requires a separate allocation.


## Complete synchronous capture snapshot

Run 005 saved diagnostic data but omitted it from the returned capture. Capture now uses
the existing geometry collector in capture mode: all imports complete first, then DOM labels,
HUD exclusions, controls and complete geometry are read synchronously without an await.
The same complete object is saved, asserted and returned. Observed draw stamps must agree;
missing data has no fallback. Geometry-only staging keeps its original return shape.
No rays, product draws or visibility queries are replayed. Screenshots occur later than the
measurement and do not prove identical-frame pixels. Both HUD placement calls receive the
complete snapshot; visibility, at least two full BOT labels and cost assertions are unchanged.
Run 005's one full bot is not acceptance. No staging repair is included. Prior failed evidence
is preserved; this correction receives syntax and whitespace checks only, pending review
and a separately allocated browser run.


## Fixed two-bot staging prerequisite

Ordinary near scenes move only bot zero to offsets (-22, -42). Camera, humans and other
bots stay fixed; negative HUD and far scenes retain their previous coordinates. No adaptive
position search or rescue is allowed. The synchronous snapshot copies the existing local
vehicle disc, disclosed as conservative evidence with unknown freshness and participation.
Before the unchanged two-full-BOT assertion, a fixture-only geometry prerequisite validates
finite current entries, shown human slots and DOM bounds, exact reserved leader bounds, HUD,
nearer discs and a mutually clear pair of bot slots. Target placements do not block their own
replacement pair; other placed bots and all nearer discs remain exclusions. Missing geometry
or no legal pair fails. No allocator, draw, visibility or terrain query is replayed. Screen-space
opportunity does not certify terrain visibility: the strict rendered-label assertion remains.
All prior failures, human priority, negative/restored HUD and cost checks remain intact.
Syntax and whitespace checks only; independent review and runtime allocation are still required.


## Observation-only staging proposal

The explicit `--observe-staging` mode is excluded from acceptance. It predeclares exactly
four positions, in this order, relative to the existing center: (-22,-42), (-22,-34),
(-14,-42), (-14,-34). This is one left-side region; the first position repeats the measured
failed setup as a reference, not a rescue. There is no early winner, adaptive coordinate or
label forcing. After ordinary setup only bot zero is teleported; camera, seed, curve, HUD,
humans and other bots retain their setup.

Each candidate records terrain height at the center and four one-metre axis offsets, finite
central slopes, exact teleport Y, immediate body/rendered position, then ordinary physics
settling. The existing predicate is shared: six consecutive changed draw stamps with camera
and actor deltas below 0.25 m, requested camera within 0.5 m/FOV within 0.5 degrees, roster
present and existing near ranges. Each candidate has the same 15-second limit and 100 ms
polling, with at most 180 history records. Failed settling is retained and does not select an
alternative; all predetermined candidates are measured unless a fatal evidence error or the
unchanged overall deadline stops collection.

Final synchronous snapshots include body position/orientation/velocity, rendered center and
world orientation, envelope radius and anchor, camera/projection/bend, HUD and label bounds,
human leader reservations, entry discs and the conservatively copied local disc. Terrain
height queries are outside cost windows; observation mode never enters a cost window or
replays label allocation/visibility rays. It takes no screenshots. Complete collection only
means observation records were saved, not settled success, legal placement or nameplate
acceptance. Offline selection and drift/margin analysis follow separately allocated evidence.
Future acceptance keeps same-frame legal-pair, actual two-full-BOT, negative/restored/far and
cost assertions unchanged. Historical evidence remains untouched; no runtime is cleared.


## Finite terrain survey proposal

`--survey-terrain` is a separate nonacceptance mode. It retains this product base rather
than rebasing to live 1602. Its reference is the exact recorded camera, projection, bend and
1440x900 viewport from run 007 snapshot 727, Volcanic seed 1 and curve 0.71. The live camera
is not moved. After ordinary native entry, the survey never calls stage or teleports actors.

The exact Cartesian sample list is X offsets [-32,-24,-16,-8,0,8,16,24,32] crossed with Z
offsets [-40,-32,-24,-16,-8,0], ordered Z then X, relative to recorded center
(13.229718186648464,-564.5650121613116). Cardinality is 54. This finite foreground region
contains the measured failed region and existing human/bot ground neighborhood, extending
across both sides of the existing camera. Maximum horizontal distance from the recorded eye
is approximately 91 m, leaving vertical-distance checks to measured heights. It does not
assert that every sample is inside full-label range or projects into a desired screen band.

Each point returns its terrain height and four one-metre axis-neighbor heights, central slope,
and curvature-aware anchor/envelope projections for explicit hypothetical body-center offsets
0.5, 1 and 2 metres above ground and radii 3.5 and 6. These hypotheses are not measured
support or settled poses. All six combinations are returned, including out-of-range or poorly
placed samples; full-bot and existing near-distance flags are data, not filters or winners.

Fixed ceilings: 270 terrain-height calls, 324 envelopes, 9,072 point projections (one anchor
and 27 envelope points per combination). Each of 54 evaluations has a three-second bound
inside the unchanged total fixture/supervisor budget. No adaptive subdivision, early success,
visibility rays, allocator execution, physics teleports, cost window or runtime selection.
Partial results persist after every sample; fatal evidence errors stop collection honestly.
Offline review may map measured ground and hypothetical envelopes to upper/flank design bands.
Any later fixed coordinated pose observation requires separate review and allocation. The
acceptance scenarios, both humans, four bots, >=2 full BOT requirement, priority/negative/far
cases, cost and every occluder remain unchanged and unclaimed by survey completion.

Survey001 stopped before its first sample because a bare `three/webgpu` import in
`page.evaluate` was not browser-resolvable. Its zero-sample failure remains preserved.
The correction clones the public `s.game.camera` and its position vector for detached
reference math; Three's camera and vector clone methods copy their mutable values.
The absolute curvature-module import remains. Sampling, reference matrices, limits and
acceptance exclusions are unchanged. Syntax checks do not establish runtime success.


## One fixed right-flank pose observation

`--observe-fixed-pose` is separate from the preserved survey, four-position observation
and acceptance modes. It declares bot65280 offset(32,0), initialY15.622831573066174 before
execution. Initial staging uses that pose directly once; it does not first place the bot
at the old coordinate or reteleport it after a failure. Other actors, yaw and cinematic
target use the unchanged stage rules. Ground and four one-metre neighbor heights, slope,
initial body height and immediate before/after pose are recorded for bot zero.

The existing 15-second ordinary settling criterion, 100ms polling and 180-row history
bound remain. At each existing poll, an installed synchronous snapshot closure records
body/rendered positions, orientations, radii, camera/projection/bend, seven discs, human
DOM/leader reservations and all four bot candidates. Imports complete before installation;
there are no asynchronous operations inside a snapshot. Settling and snapshot stamps
must agree. Existing renderer visibility/sight/query-budget decisions are copied, with no
extra terrain rays, draw or allocator invocation. The existing passive terrain observer
only records rays already issued by the product.

Per-poll arithmetic records all four candidate-slot margins to HUD, existing shown
leader reservations, nearer discs including the conservative unstamped local disc, and
viewport. It never chooses a slot or asserts placement success. Human reservations carry
current-slot and DOM agreement validity; hidden/missing reservations remain explicit.
Observed geometry and margins are saved as history even when settling times out. A timeout
or incomplete evidence stays a failed run; no alternate coordinate, rescue or retry follows.

The observation has no cost window and sets acceptanceEligible=false. Survey offset
hypotheses are not settled-pose bounds. The retained radius-six bot's roughly9.69px reference
clearance remains the weak constraint and requires moving-frame review. Both humans plus
at least two full BOT labels, priority/restoration, negative HUD, far and cost checks remain
unchanged future acceptance requirements. Preparing this mode grants no execution slot.

The initial pose receipt now also retains the existing ground result, requested teleport
height and immediate before/after body position, orientation and rendered position for
all seven actors. Each includes its actual local network or host tag identity. Host bot
index zero must map to65280, and all four indices must match their network IDs. Raw host
and human receipts are persisted before finite, unique-identity and expected-role checks.
No additional height queries, coordinates or settling changes accompany this correction.

## Measured positive-near acceptance scene

Source preparation only. Fixed-pose002 offline review supports the exact Volcanic seed-1
scene with bot65280 offset (32,0), initial Y 15.622831573066174. Its short observed window
had a minimum moving clearance of 9.272615 px; that is preparation evidence, not a stability
or cost pass. Product code, observation branches and historical receipts remain unchanged.

`stage` now accepts an explicit fourth argument, defaulting to `default`. Only the initial
acceptance positive-near call and its restoration select `volcanic-positive-near`. It requires
Volcanic seed 1, the recorded center, desktop 1440 by 900, curve 0.71, and neither far nor
HUD-overlap mode. Bot zero's existing ground query must be finite and equal the measured
initial height minus two; its tag identity must be 65280. The pose is applied once during
initial staging with ordinary settling. Other six actors and cinematic camera are unchanged.
No slope queries, adaptive placement, retries or visibility forcing were added.

Callsite mapping:

| Call | Scene and behavior |
| --- | --- |
| Initial full acceptance | Explicit measured positive-near |
| Positive restoration after negative HUD | Explicit measured positive-near |
| Four-position observation initial stage | Default, unchanged |
| Fixed-pose observation | Default plus existing observation-only pose, unchanged |
| Survey | No stage call, unchanged |
| Deliberate contested/negative HUD | Default, unchanged |
| Desktop curve near/far and far cost | Default, unchanged |
| Presentation and phone near/far/night | Default, unchanged |
| Snow | Default with terrain-relative height, unchanged |
| Settings, Zorb and materialization | No new stage call; follow restored positive scene as before |

The same-frame finite/current geometry and legal-pair precondition remains separate from
actual rendered visibility. Initial and restored positive scenes require at least two full
BOT labels, with ticks explicitly excluded. Human visibility, bot size/opacity, contested
priority, negative HUD, far, settings, curvature and cost windows retain their checks.
The 512-query fail-hidden bound is unchanged. Missing geometry or a changed scene fails.

Proposed external acceptance supervisor: `/tmp/nameplates-current-launcher/run-08.py`,
with versioned `source-pins-08.json` and fresh output `/tmp/nameplates-current-browser-008`.
It derives from reviewed pose02 startup diagnostics and ownership/cleanup handling, removing
only the observation argument/verdict requirements in favor of full acceptance mode.
The proposed invocation requires separate review and runtime allocation: absolute
`/Users/vtn/dev/Syn3h/tools/heavy.sh`, Python 3, the versioned supervisor, exact pinned
`/opt/homebrew/Cellar/node/26.9.0/bin/node`, and that fresh evidence directory.
Budgets remain 590 seconds total, work cutoff 510, and full 480-second fixture admission
(450 work plus 30 cleanup). Ports 5331 and 54671 remain owned; 8787 remains read-only.
No execution, probes, installation, browser, tests or typecheck accompanied preparation.

## Acceptance settling receipts

Source preparation only after the preserved acceptance008 timeout. Each existing acceptance
stage wait has a fixed sequence/scene identifier and one receipt, capped at 180 poll rows.
The existing 100 ms polling, remaining 15-second timeout, six-count criterion, actor order,
short-circuit evaluation and persistent `window.nameplateSettle` counter remain. The recorder
never resets that counter. Repeated stamps are retained. Missing previous state, pose or
unavailable lifecycle data is explicit null, not an invented zero measurement. Keys absent
from `evaluated` identify operands skipped by short circuit; raw stable/result state is also
saved. The recorder adds no polls, terrain queries, rays, imports, awaits or draws inside the
predicate. Observation-only branches keep their existing history and do not use this receipt.

Each synchronous row copies current/previous stamps, ordered rendered actors, eye positions,
in/out counters, reached predicate operands, result, wall timestamp, physics tick/time,
frame count and public pause state. Separate diagnostic arithmetic records camera and actor
deltas and cinematic distance/FOV error without re-evaluating allocation or visibility.
Read-only lifecycle fields use existing Vehicle.kind, object.userData.materializing,
Rapier body.bodyType(), and RemotePlayer.responding/paused. A missing materializing property
is null; it is not certified false. No remote replica is represented by remoteAvailable=false
and null remote fields. No owning-client polling or simultaneous owner/replica claim is added.

The row enters the raw buffer before lifecycle copying. After each wait, raw partial data
is persisted before identity, cardinality, finite-value and lifecycle completeness checks.
A cap overflow fails, preserving the capped data. Retrieval, validation or persistence errors
are secondary when the original wait already failed; they cannot replace its timeout.
Receipt completion means collection completeness, not that settling or acceptance passed.
All receipt work occurs at staging waits outside cost windows. The future run keeps the
original visibility, human priority, two-full-BOT, negative/restored, far and cost requirements.

Versioned proposal `run-09.py` and `source-pins-09.json` under the existing external launcher
directory only repin the source HEAD and fixture bytes from run08. Proposed fresh output is
`/tmp/nameplates-current-browser-009`. Supervisor ownership, startup diagnostics, cleanup,
ports and 590/510/480 budgets remain unchanged. Syntax/AST and whitespace checks only are
permitted during this preparation; independent review and runtime allocation remain required.

## Arrival before post-arrival stability

Source proposal after review of run009. Four far waits completed on old near positions;
the desktop curve-zero far capture also remained near (52.72/52.91 m). Later desktop
curves and phone curve0.71 had far x/z but lacked six post-arrival stable samples. Far
day/night humans were roughly307.76/238.57 m away with both plates hidden, not evidence
of positive human far visibility. Far cost samples have no per-sample geometry; surrounding
captures provide context only. These qualifications apply to preserved evidence, not rewritten
historical verdicts.

Existing staging evaluations now return all seven commanded x/z positions, identities,
requested heights and immediate before/after owner body/rendered poses. Existing height
results are reused. The owner boundary copies timestamp, tick, velocity, input, kind, body
type and materialization state through confirmed APIs. The two remote owners are read in
separate existing evaluations; their timestamps are local and not synchronized. No owner
polling, extra terrain queries or contact probes are added. Each completed owner boundary
is persisted immediately after its existing evaluation, before the next owner evaluation
and before finite/identity checks. Later owner failures retain earlier receipts. Immediate rendered poses may still precede the teleport draw.

Source basis for the arrival criterion:

- `shared/protocol.ts` encodes and decodes position as Float32, not centimetre quantization.
- `SnapshotBuffer` interpolates between timestamped positions and extrapolates velocity.
  Receiving a packet or seeing `responding=true` therefore does not certify rendered arrival.
- `RemotePlayer.steer` can blend a dynamic proxy, snap errors above15 m, or set the next
  kinematic pose. `reimage` preserves the local wrap image. None supplies a public teleport
  acknowledgement or a guaranteed fixed arrival latency.
- Strict0.25 m is a conservative fixed-scene arrival requirement, not a transport-error
  bound or a mathematical consequence of the stability threshold. Float32 error at these
  sub-kilometre coordinates is below0.000031 m per axis. Neither that error nor the15 m
  snap rule guarantees arrival within this requirement.

At each existing acceptance poll, all seven expected identities, including the local player,
must resolve with finite commanded x/z and complete finite rendered XYZ. Malformed geometry
is saved in the raw polling row before failing closed. Each rendered horizontal position
must be strictly within0.25 m of its commanded Float32 x/z. The same rendered tile is
required; drift or wrap disagreement fails. The requirement will not be loosened after a
failure. It does not force positions or choose new ones.
The intended list and per-identity errors are retained in the same polling receipt.

The original persistent counter, comparisons, repeated-stamp resets and short-circuit result
remain unchanged and are recorded as `originalResult`. A separate post-arrival count starts
at zero per existing stage wait. It increments only when the preceding AND current poll
have all actors arrived and the original stable comparison is true; otherwise it resets.
Success requires both the original result and six post-arrival stable comparisons. Thus an
inherited count of six cannot admit a stale near scene or a first arrival sample. Repeated
stamps still break both streaks. This strengthens readiness without altering the original
counter or suppressing its evidence.

The arrival check and post-arrival count share the existing100 ms polling and remaining
15-second wait, with the same180-row cap. There is no new wait, timeout extension, owner
poll, ray, draw, allocator replay or physics mutation. Observation-only modes retain their
existing settling behavior. No changes to coordinates, camera, visibility/priority/negative
assertions or cost windows are included. Independent source review must accept the proposed
spatial criterion and separate count before any execution. No launcher or runtime was run.

## Positive coverage design after independent review of run 010

Design only. No fixture implementation or runtime is authorized by this section. The saved
scene math does not justify new actor placements. The current fixture remains unchanged;
its empty phone/follower/mode results are not positive feature acceptance.

### Explicit expected sets and existing-boundary receipts

At each existing phone day/night and camera-mode capture boundary, a future positive check
must require Visitor and Companion plus full BOT labels for IDs65280 and65283. At the
follower boundary, require Observer and Companion plus those two replica bot IDs. Resolve
human IDs from the actual roster, require distinct IDs and exclude the local ID. Require the
expected set before testing uniqueness, size, opacity or exclusion compliance. An empty or
partial set fails, even when no duplicates or overlaps exist. Keep the original two-human,
two-full-bot desktop positive, contested negative, restoration, settings and cost assertions.
Do not convert far or intentionally hidden cases into these near positives.

Extend the existing synchronous geometry snapshot, after its existing imports finish, with:

- Local ID, host ID, isHost, actual requested camera mode, whether cinematic pose is active,
  presentation, viewport, actual game-camera identity, near/far, world/inverse/projection
  matrices and current bend. Copy values, not mutable camera references. State whether the
  nameplate camera identity equals the active game camera; missing identity fails closed.
- All seven actor identities and existing body/rendered poses, hull kinds/radii, object
  visibility and current center depth. Preserve current candidate/disc stamps and the raw
  local disc separately. A candidate stamp alone does not prove its disc participated.
- Predicate-derived disc eligibility, clearly distinguished from observed participation:
  local center depth must exceed local radius (`VehicleNameplates.ts:129`); a remote center
  must exceed camera.near, be visible and not over the horizon (`:144`). Use the snapshot's
  center, bend and camera matrix to derive center depth, without projecting a new envelope,
  drawing, allocating or querying terrain. Existing overHorizon evidence is already copied.
  If draw-time inputs cannot be matched to this snapshot, mark participation unknown. Do not
  silently treat a stale stored disc as eligible, or remove it from a positive precondition.
- Current HUD boxes, existing terrain-query decisions and budget, and exact shown DOM boxes
  including leader reservations. Preserve raw data before completeness assertions. No new
  page evaluation, polling loop, ray, height query or product visibility replay is proposed.

A receipt with unknown participation can identify a measurement gap, but cannot certify a
positive legal placement. Product currently provides no stamped local-disc participation
field. If matching immutable draw inputs is insufficient, request narrowly scoped diagnostic
instrumentation separately; do not pretend a fixture-derived predicate is a draw receipt.

Keep the strict0.25 m arrival criterion, original persistent counter, six separate post-arrival
comparisons, repeated-stamp behavior, existing15s/100ms/180 bounds and all stage coordinates.
Per-observer readiness must use that observer's actual camera, never the host camera as a
substitute. No tolerance or timeout change is proposed. Do not run the current empty setup
again with stronger assertions and call that new evidence.

### Finite measurement proposal for separate review

Exactly TWO predeclared measurement cases, one phone and one ordinary-camera follower.
These are setup observations, acceptanceEligible=false, not an acceptance retry. There is
no coordinate sweep, early-success selection, alternate candidate, reteleport rescue or
follow-on acceptance job. The cases retain the existing Volcanic seed1 default near actor
x/z offsets and ordinary ground initialization, all three clients and four bots including the
radius6 actor. No measured desktop absoluteY is reused, and no Snow coordinates are used.

1. Phone observer:390x844, day12, curve0.71, mode0 chase, cinematic override cleared,
   camera.distance25, presentation off. This replaces the inherited desktop cinematic view.
2. Visitor follower:640x480, same Volcanic default near world/actors, day12, curve0.71,
   mode0 chase, cinematic override cleared, camera.distance25, presentation off. Confirm
   isHost=false and remote bot replicas before recording. Do not inherit the final Snow case.

The single distance25 choice is the existing registry's maximum supported orbit distance
(`ChaseCamera.ts:13`), not a fitted coordinate or a claimed visible solution. Saved010 local
foreground discs were about496 px for the observer and497 px for the follower at the short
chase arm; observing the supported outer arm tests whether usable space exists without
shrinking or removing that occluder. Both cases change the view, not actor coordinates or
occlusion rules. No assertion that25 guarantees ground clearance, actual25 m camera distance,
legal slots or positive labels is made. The real camera may shorten its arm against terrain.

Predeclare at most180 existing readiness samples per case and one final existing capture
boundary per case, at most362 snapshots total, all retained including repeated stamps and
failed waits. There are zero additional terrain samples, envelope projections, allocator
calls or visibility rays. Copy only existing stage ground/height receipts and existing draw
results. Imports finish before each synchronous copy; samples must not cross awaits. A future
implementation must demonstrate that these samples attach to the existing readiness predicate
and do not add polling or reset the persistent counter. The existing total/work/fixture budget
remains590/510/480; no new allocation or extension is implied.

Offline review would inspect both complete histories, actual camera arm/ground response,
all eligible/unknown discs, real HUD and leader-inclusive margins for the predeclared expected
sets. No live winner is selected. Missing ground receipts, uncertain participation, failed
settling or no legal space are explicit nonpassing outcomes. The missing facts are actual
camera clearance and stable projected space at the supported outer arm with these actors;
saved010 cannot provide them. Positive acceptance still requires a separately reviewed fixed
scene and actual rendered expected labels, not merely offline boxes.

### Separate envelope design if legal space remains blocked

This is a conditional product-design proposal, not permission to change the module. The
current26-point cube-to-circle envelope can cover much more screen area than the vehicle,
especially when one sample crosses the near plane. If eligible local-envelope blockage
persists, inspect a conservative projected hull with explicit near-plane clipping rather
than a viewport-diagonal fallback circle. Keep foreground vehicle occlusion, the local
vehicle, curvature, wrap image and all HUD rules. Do not reduce radii by an empirical factor,
remove discs or relax the3 px padding just to pass a scene.

Smallest separate design fence would be `anchors.ts`, `curvature.ts`, and focused geometry
regressions; any need to change the disc-shaped layout interface must be returned for scope
review before implementation. Required proposed regressions cover a partially near-plane
crossing hull, camera inside/behind hull, curved0/0.71/1.8 views, local versus remote hulls,
Jet/Zorb extents, actual projected-hull containment, and an unobscured label outside the hull
while a behind-hull label remains rejected. A clipped sphere/cube is still not a mesh silhouette;
choose the conservative representation from measured geometry before claiming a defect fixed.

Source/coverage basis: `/tmp/nameplates-010-integration-and-coverage.md` and its saved-data
arithmetic JSON. Root integration remains plan-only. The next review should decide whether
the two-case measurement contract is sufficient or whether draw-participation instrumentation
is needed first. No new placements, product changes, tests or runtime were performed here.

### Implementation intake: ordinary-camera readiness contract gap

Source inspection on d2b67 confirms that instance-local draw/envelope wrappers are feasible:
`afterCameraFrame` calls `this.draw(this.entries)` dynamically, so an own-property wrapper
can intercept that exact instance. `VehicleNameplates.draw` calls `projection.envelope`
immediately before each local/remote `discs.push`; normal synchronous draw return can
certify those recorded outputs reached that draw's disc list. A thrown draw cannot certify
participation. The local branch is skipped when center depth does not exceed local radius;
a hidden-layer early return also needs an explicit skipped reason, not a cached local disc.

A safe implementation must capture original own descriptors (including absence), forward
with Reflect.apply exactly once and preserve the original return or thrown value. Recorder
errors are sticky secondary failures; they cannot replace a product exception or trigger a
second call. Keep at most seven copied envelope results in the active draw, publish only
bounded latest state, and mark a completed draw separately from its partial envelope list.
Restore only while the installed own descriptor still matches the wrapper. A foreign
replacement is an explicit cleanup failure and must remain untouched. Disposal also needs
an instance-local forwarding wrapper, with exact descriptor restoration before forwarding
original disposal once. No product prototype changes are needed. These are source findings,
not executed wrapper tests or completed instrumentation.

The blocking ambiguity is the existing observation wait, not access to these methods:

- `tests/ui/nameplates.mjs:617` hard-codes remote names Visitor and Companion. On the Visitor
  follower, Visitor is local and is deliberately absent from tags, so that predicate cannot
  pass even when the correct Observer/Companion roster is complete.
- `:642-644` requires `s.camera.cinematic` and compares camera position/FOV to that pose.
  Both approved cases explicitly clear cinematic mode. Keeping this conjunct makes success
  impossible; re-enabling cinematic mode would defeat ordinary-camera measurement.
- `stage():764` installs the cinematic pose on the host and later waits on the host. Clearing
  it after the wait would sample a different camera from the one that established readiness.
  Polling the follower separately would add a wait instead of attaching to the existing one.

Smallest proposed resolution for independent source authorization: make only the new
observation branch's existing wait accept an explicit observer page, expected remote names,
and a declared ordinary-camera readiness variant. It would retain and record the original
cinematic `originalResult` as false, without requiring it for this observation-only outcome.
Require mode0, cinematic absent, distance setting25, finite actual camera matrices, unchanged
controls, exact actor arrival and the original stable six-comparison arithmetic plus six
post-arrival comparisons. Preserve persistent counters, repeated-stamp resets,15s/100ms/180,
all coordinates and one wait per case. No new camera convergence tolerance is proposed;
record actual pivot, desired (after lift), final camera, arm and lift without claiming they
are a pre-terrain desired position or synchronized with another client.

The acceptance branch must remain byte-for-byte unchanged in its readiness semantics.
Observation success would mean bounded collection/readiness only, never positive label or
feature acceptance. Failure still retains all partial samples and the first original error.
This limited observer/readiness distinction needs resolution before implementing the whole
package; installing wrappers alone would leave a knowingly impossible measurement branch.
No fixture code, launcher pins, product code or prior evidence was changed during this intake.

### Implemented source proposal: passive two-view observation

`--observe-views` is a mutually exclusive observation-only fixture mode. It declares phone
Observer390x844 and Visitor follower640x480, both Volcanic seed1/curve0.71/day12/chase0,
requested distance25, presentation off and cinematic cleared. Each case stages all seven
actors with existing default-near coordinates and ground queries before configuring its
observer. It then uses exactly one existing15s/100ms wait on that page. No host wait precedes
the follower wait. The acceptance branch keeps its cinematic readiness, coordinates and
positive/negative/restoration/cost assertions unchanged.

The observation wait copies the original counter operands and original cinematic result
(false), then records ordinaryResult separately. It requires finite camera/actor data,
explicit observer roster, declared controls and all-seven arrival. Persistent original
count and the separate six post-arrival comparisons retain their existing arithmetic.
An additional observation-only streak requires six consecutive comparisons whose preceding
and current polls both have arrived actors and a matching completed draw. It does not reset
the original counters. Repeated stamps remain failures of the existing stable comparison.
There is no quaternion/FOV convergence threshold: those values and matrices are receipts
for offline drift analysis only. Pivot, desiredAfterLift, final position, arm and lift are
copied; desiredAfterLift is not misrepresented as the unconstrained camera target.

The actual instance's draw, projection.envelope and disposal methods are passively wrapped.
Each original is forwarded once with the same receiver and arguments, preserving its result
or thrown value. A successful envelope output is associated by object identity with localDisc
or one current plate.disc. The source places discs.push immediately after these calls.
Only normal completion of that same draw marks participation complete; throws retain partial
outputs without certifying geometry. Every new draw starts with local status unknown, then
sets participated or skipped on completion. No stale local envelope is used as evidence.
At most seven unique envelopes are copied per draw, with center/radius/output, stamp, bend,
viewport and contemporaneous camera. Only latest draw state is retained between polls.

Sticky recorder errors (up to eight messages plus dropped-error count), duplicate output,
overflow, foreign descriptor replacement and incomplete final draw prevent collection success.
Descriptors are restored exactly, including deleting instance overrides originally absent.
Restoration refuses to overwrite a foreign replacement. Disposal forwards once after restore;
fixture cleanup also restores before closing contexts. Original wait errors remain primary
if final receipt collection fails. Raw polling rows and final data are persisted before checks.

Each case retains at most180 poll samples plus one final sample, maximum362 total. No extra
projection, envelope computation, draw, allocator call, terrain ray or height query is added.
HUD/DOM and existing actor state are copied synchronously at these boundaries. Observation
mode returns before the old stage geometryEvidence path, avoiding its projection computations.
No cost window runs and recorded draw stats are not a performance claim under instrumentation.
Expected people and full-bot sets are recorded with observed membership; observation success
is not a positive visibility assertion or acceptance. Missing labels remain missing evidence.

Source prepared only: Node syntax and whitespace checks are permitted; no module imports,
tests, browser, server, network or launcher execution was performed. The existing run10
launcher is not repinned and must not execute this HEAD. A separately reviewed observation
launcher would need the explicit mode argument and unchanged ownership/budget contract.


Final observation validation now checks the persisted envelope list is bounded by seven,
each envelope stamp matches the completed draw, viewport dimensions and camera/output
identities agree, and center/radius/bend/disc/camera numbers are finite. Final camera near/far
are finite too. These checks run after raw persistence, add no samples or product calls,
and leave an original staging error primary if final validation fails.

HUD rectangles are read at poll/final-sample time. They are not an exact copy of the prior
allocator's exclusion list: matching the draw stamp or camera alone does not prove HUD
layout remained unchanged. Treat them as contemporaneous sample context unless separate
matching evidence establishes allocator-time equality. Do not certify exact prior HUD
exclusion compliance from those rectangles alone.
