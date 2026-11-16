# Clean lobby address browser gate

Prepared source only. Typecheck and 29 units passed on product source
`d85b9db098b7b9a73157968db7489f5da42f3a91`. This fixture has not run.
No launcher, Worker, application or artifact changes belong to this handoff.

## Required independent setup

The coordinator must supply an already running, isolated frozen artifact origin and
room server using established release tooling. Do not run against production or a
shared public room. A Vite origin does not establish frozen Worker routing. If the
existing tooling cannot supply the following fixtures, that setup is a prerequisite,
not permission for this lane to build another launcher:

- The candidate production artifact served through the existing Worker, or a clearly
  identified local fixture. Report `routing` as `real-worker` or `local-fixture`.
  A local fixture result never proves the production Worker route.
- Both root query-version and `/v/<version>/` document entries, same product revision.
- A dedicated room origin reachable by the artifact's configured networking. The
  second entry uses the actual room name `lobby`; use a private server so this does
  not join the public lobby. The first uses another unique room name.
- Exact expected frozen hashes for both Buggy models and ten licences, with explicit
  `/v/<version>/` URLs. Frozen and latest bytes may be identical. Optionally supply
  one independently prepared distinct resource and its latest hash to demonstrate
  byte discrimination. Existing permitted resources suffice; no new mesh asset
  project is required. No application response is mocked by Playwright.
- A separate isolated missing-model origin with the same artifact and one frozen
  Buggy mesh absent (404), while the latest counterpart exists. All other resources
  work normally. Never remove files from a deployed version.
- An independent build receipt mapping product source to the artifact, with SHA-256
  hashes of all browser-loaded document, script and stylesheet bodies. The fixture
  verifies actual browser response bytes against that receipt. It cannot prove the
  build process solely from a supplied commit label.

Supply a JSON manifest using this schema (placeholders are not executable evidence):

```json
{
  "version": "26.11.1520",
  "sourceSha": "full product source commit",
  "routing": "real-worker",
  "isolated": true,
  "artifactReceipt": "independently supplied build receipt identity",
  "sourceFiles": { "src/main.ts": "sha256; include every source named in fixture" },
  "resources": {
    "/models/buggy.glb": { "frozen": "sha256" }
  },
  "entries": [
    { "url": "https://isolated-origin/", "room": "url-check", "roomSocket": "wss://isolated-room/ws", "requiredResponses": ["/", "/assets/index-HASH.js", "/assets/index-HASH.css"], "responses": { "/": "document sha256", "/assets/index-HASH.js": "bundle sha256", "/assets/index-HASH.css": "stylesheet sha256", "/assets/conditional-HASH.js": "conditional JS sha256" } },
    { "url": "https://isolated-origin/v/26.11.1520/", "room": "lobby", "roomSocket": "wss://isolated-room/ws", "requiredResponses": ["/v/26.11.1520/", "/assets/index-HASH.js", "/assets/index-HASH.css"], "responses": { "/v/26.11.1520/": "document sha256", "/assets/index-HASH.js": "bundle sha256", "/assets/index-HASH.css": "stylesheet sha256", "/assets/conditional-HASH.js": "conditional JS sha256" } }
  ],
  "missing": { "isolated": true, "url": "https://isolated-missing-origin/", "path": "/models/buggy.glb", "roomSocket": "wss://isolated-room/ws", "requiredResponses": ["/", "/assets/index-HASH.js", "/assets/index-HASH.css"], "responses": { "/": "document sha256", "/assets/index-HASH.js": "bundle sha256", "/assets/index-HASH.css": "stylesheet sha256", "/assets/conditional-HASH.js": "conditional JS sha256" } }
}
```

`resources` must include both Buggy model paths and all ten licence paths enumerated
in the fixture. Optional `distinctResource` is an object with `path` (one of those
12 paths) and `latestSha256`, different from its frozen hash. If supplied, the normal
cases also fetch that root path with an unversioned Referer and verify the latest
hash independently. Without it, results prove requested frozen paths and exact
expected bytes, not discrimination between otherwise identical bytes. `responses`
is the full allowed hash inventory, including conditional worklets, workers and lazy
chunks. `requiredResponses` contains the document and actual external script and
stylesheet references parsed from the built HTML, resolved against that entry URL.
Only that required set must be observed. Every observed conditional executable/style
response is still hashed and checked against the allowed inventory; unexpected paths
fail. Context-level events and path/MIME classification cover observed worklet or
worker responses reported as other/fetch rather than script. An absent conditional
request is not execution coverage. Each entry has its own map because frozen pathname
rewriting may change asset paths.
`sourceFiles` covers the exact ten product/config files listed in the fixture.
The script adds version, room, `world=volcanic.1~bots.count=0`, explicit seed 1,
Jet, Minimal and a retained fragment to each entry URL. This is the supported
`encodeWorld`/`decodeWorld` format, not a standalone bot query parameter. Main decodes
it before Game construction. The fixture asserts the actual Jet, Volcanic recipe,
seed 1, requested bot count zero and empty bot fleet before checking model requests.
It enters the current planet, preserving that recipe. Normal networking must confirm
the dedicated room URL. Bot behavior is configured through the ordinary shared-world
setting; no private state, request interception or product behavior is changed.

The world query does not replace the explicit entry-seed check: `prepareResume` runs
after world decoding and reapplies the saved host world and seed 42 when the unchanged
entry seed is 1. The saved world retains zero bots. Invitations still encode the
current world through the production encoder and retain room/version; they need not
equal the original seed-1 recipe after the host edits the seed.

Gate 02 observed frozen Buggy requests before its generic no-model assertion. Source
shows main constructs BotManager before Shell (`src/main.ts:85`); its update spawns
Buggy bots (`src/bots/BotManager.ts:111,145`), with default count four and Minimal
budget two. Buggy construction loads both observed files
(`src/vehicles/skins/LoadedBuggySkin.ts:213`). Materialize prewarm compiles its cloud
shader, not vehicle assets. This explains a valid source path consistent with the
requests, not a captured request initiator stack. The failed evidence is preserved.

## Smallest executable allocation

Once the setup and manifest are independently reviewed, allocate one serial run:

```sh
UX_SOURCE_SHA=<full fixture checkout HEAD> \
UX_FROZEN_MANIFEST=<absolute independent manifest path> \
UX_EVIDENCE_DIR=<new absolute evidence directory outside checkout> \
/Users/vtn/dev/Syn3h/tools/heavy.sh node tests/ui/lobby-address.mjs
```

Run from the clean fixture worktree with its matching existing dependencies. No
installation, build or server startup is performed. An existing reviewed external
supervisor must cap the fixture at 480 seconds, reserve bounded cleanup, and report
PID/start identities and room/browser/server ownership closure. Do not infer process
closure from the script finishing. Its `Promise.race` deadlines reject hung operations
but cannot kill a hung browser process. Checkpoints are written before risky
transitions, before cleanup, and after each case, using a temporary file and rename.
Write or cleanup failures remain nonpassing and do not replace an earlier failure.
An external kill can still interrupt the newest write; only already persisted
checkpoints can be promised, not complete evidence after every kill. Stop on first
failure without retry.

Installed Chrome runs desktop first, then Playwright WebKit runs iPhone 14 emulation.
Each runs the root-query and frozen-path cases in fresh, service-worker-blocked
contexts. Pass-through request routing disables HTTP cache without replacing bytes.
Only Chrome runs the additional isolated missing-model case. Native keyboard Enter
activates the planet in both contexts; this does not claim physical touch coverage.

## Assertions and limits

- Initial lobby, confirmed Leave world and already-joined reentry preserve pathname,
  remove all lobby query/hash, restore intentional play room/seed/version, and do
  not reload on reentry. A room named `lobby` remains a real play room.
- Jet in the asserted zero-bot shared world starts without mesh requests. Both Buggy
  files remain unrequested immediately before the Tank swap and before the Buggy
  swap. Normal vehicle controls then exercise both
  uncached late mesh requests after lobby cleanup. Each response must match frozen
  paths and expected hashes. Only an optional independently distinct resource can
  additionally demonstrate frozen/latest byte discrimination.
- After the generated Tank and Buggy mesh checks, the normal selector returns to Jet before
  save/reload, matching the original explicit vehicle query. The saved snapshot must
  have `kind: jet`, so a deliberate vehicle override cannot defeat resume selection.
  The normal seed editor changes the host world to 42. Periodic save and an explicitly
  synthetic `pagehide` retain entry seed 1. Reloading the original entry resumes seed
  42. This checks saved seed selection, not the separately guarded physical position
  restore. The fixture does not directly call save or mutate resume storage.
- Multiplayer retains room, version and world in its displayed invitation. About has
  exactly ten frozen licence links; each is read through the browser context request
  client and checked against frozen bytes. This proves href and resource delivery,
  not popup/tab activation or QR decoding. Terran Labs remains an external link.
- The missing-model case observes an actual loader request receiving 404. No root
  retry may appear during the case, including 500 ms after the failed response. This
  finite observation is not proof against an arbitrarily delayed retry; source/unit
  evidence separately establishes that no retry mechanism exists.
- Browser document/module hashes, page errors and dynamically tracked response errors
  are checked through page closure. Cleanup errors retain the original failure.
  A failed close or expired deadline is nonpassing and requires supervisor closure.
- Hard reload of a cleaned root intentionally selects latest. A direct frozen link
  selects its build before cleanup; a frozen pathname stays frozen on reload. This
  fixture does not turn clean root reload into a frozen-link promise.

No browser or network acceptance, release approval, or deployment follows from source
review or syntax checks alone.

## Gate 03 source audit and corrected coverage

Normal Tank construction selects the approved procedural Sherpa (`Tank.ts:25-31`,
`rebuild` at 99-124). It sets public scene metadata `cockpit` and `ownLamps` true,
creates geometry, and resolves `modelReady` without invoking `VehicleModel`.
The legacy branch alone loads Tank GLBs (132-159). Its only body-selection control
is the development lab lineup slider, outside this production fixture. No lab hook,
private design mutation or invented production parameter is used. The fixture reads
kind, modelReady, geometry count and those public scene flags after the actual Tank
selector, and rejects legacy Tank requests throughout the case. Legacy VehicleModel
runtime coverage is explicitly absent; existing source/unit evidence remains separate.

The swap helper waits for active kind, not skin completion. Normal Tank is already
constructed by then; its public ready promise is now observed explicitly. The recorded
camera mode is diagnostic, not changed. Production swap caching and the background
warmer remain enabled (`swap.ts:41-63,83,123`). They can construct a vehicle before its
selection. Therefore the Buggy absence checks are retained before both swaps, and a
run that warms those files earlier fails rather than claiming click causality. Passing
checks establish requests after those boundaries, not a captured loader initiator.

The missing-resource setup now removes only the frozen Buggy mesh, retains its root
copy, and invokes the ordinary Buggy selector. LoadedBuggySkin loads the pair;
Syn3hBuggy attaches a rejection handler to its ready promise. The existing 404 and
no-root-retry assertions remain, with no suppression of page errors. Both actually
used Buggy files plus all ten licences have runtime hash assertions; retained legacy
Tank inventory hashes are archival metadata, not runtime coverage.

The remaining source audit confirmed Me still uses internal section `you`, the seed
row is a direct child of its details group, numeric Enter commits the edit, the
multiplayer invitation and About licence markup match the selectors, and ResumeSession
saves entrySearch independently of the cleared address. Those interactions still need
runtime validation. Gate 03 recorded startup state only, not Tank design or cache state;
its absent Tank requests alone were not proof of a network or selector failure.
