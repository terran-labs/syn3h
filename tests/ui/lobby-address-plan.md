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
- Valid distinguishable frozen and latest model/licence bytes. Model files must be
  valid permitted meshes. No application response is mocked by Playwright.
- A separate isolated missing-model origin with the same artifact and one frozen
  Tank mesh absent (404), while the latest counterpart exists. All other resources
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
    "/models/tank.glb": { "frozen": "sha256", "latest": "different sha256" }
  },
  "entries": [
    { "url": "https://isolated-origin/", "room": "url-check", "roomSocket": "wss://isolated-room/ws", "responses": { "/": "document sha256", "/assets/index-HASH.js": "bundle sha256" } },
    { "url": "https://isolated-origin/v/26.11.1520/", "room": "lobby", "roomSocket": "wss://isolated-room/ws", "responses": { "/v/26.11.1520/": "document sha256", "/assets/index-HASH.js": "bundle sha256" } }
  ],
  "missing": { "isolated": true, "url": "https://isolated-missing-origin/", "path": "/models/tank.glb", "roomSocket": "wss://isolated-room/ws", "responses": { "/": "document sha256", "/assets/index-HASH.js": "bundle sha256" } }
}
```

`resources` must include all four model paths and all ten licence paths enumerated
in the fixture. `responses` must include every document/script/stylesheet expected
in that case, including lazy chunks; extra entries fail if never observed. Each
entry has its own map because frozen pathname rewriting may change asset paths.
`sourceFiles` covers the exact ten product/config files listed in the fixture.
The script adds version, room, seed 1, Jet, Minimal and a retained fragment to each
entry URL. No world preset is injected; the current planet is entered so it cannot
replace the explicit seed. Normal networking must confirm the dedicated room URL.

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
but cannot kill a hung browser process. Stop on first failure without retry.

Installed Chrome runs desktop first, then Playwright WebKit runs iPhone 14 emulation.
Each runs the root-query and frozen-path cases in fresh, service-worker-blocked
contexts. Pass-through request routing disables HTTP cache without replacing bytes.
Only Chrome runs the additional isolated missing-model case. Native keyboard Enter
activates the planet in both contexts; this does not claim physical touch coverage.

## Assertions and limits

- Initial lobby, confirmed Leave world and already-joined reentry preserve pathname,
  remove all lobby query/hash, restore intentional play room/seed/version, and do
  not reload on reentry. A room named `lobby` remains a real play room.
- Jet starts without mesh requests. Normal vehicle controls then cause all four
  uncached late mesh requests after lobby cleanup. Each response must match frozen
  bytes, never latest bytes.
- The normal seed editor changes the host world to 42. Periodic save and an explicitly
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
