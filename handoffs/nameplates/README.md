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
