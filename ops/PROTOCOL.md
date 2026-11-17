# Coordination protocol

How the Syn3h lanes work together through the Sunday noon handoff. Updated by the
Foreman on 15 November 2026 to reflect the owner's overnight and default-on directions.
Later explicit owner decisions take precedence over historical notes.

## 1. One trunk, one merger

`main` is the only integration branch and the Orchestrator is the only thread that
merges into it. Everyone else commits to their own branch in their own worktree and hands
off by message. Nobody but the Orchestrator edits the integration checkout.

## 2. Every lane has a file fence

A lane owns the paths listed for it in `ops/LANES.md` and nothing else. A change outside the
fence is a request to the Orchestrator, which routes it to the owning lane. Shared seams
(the `Vehicle` interface, `shared/params.ts`, `main.ts` wiring, the terrain data contract)
change only through the lane that owns them, and the Orchestrator announces a seam change
to every lane that consumes it.

## 3. One gate, the same for everyone

A handoff is ready when, on the lane branch with `main` merged in first:

1. `npm run typecheck` passes.
2. The lane's own test folder passes (`npx vitest run tests/<lane>`).
3. `node tools/smoke.mjs <lane preview url>` prints `SMOKE OK`.

Lanes run their own tests; the Orchestrator owns combined acceptance. Heavy jobs
(test runs, builds, headless browsers) go through the integration `tools/heavy.sh`, which
allows three at once machine-wide. Unit tests and typechecks need no allocation or
permission: run them. There is no separate runtime allocation, receipt or pin step; the
testing principle in `AGENTS.md` sets how much checking a change needs.

Replace preview configuration atomically. When editing `paseo.json`, write a complete
temporary sibling file, parse it successfully, then rename it over the destination. Do not
truncate the live file while writing: the broker can read invalid JSON, fail closed and
remove every affected HTTPS mapping even while its backend continues running. The service
owner handles recovery through one scoped broker start, or restart if the definition changed,
then verifies both the HTTPS response and rendered content. Old ready receipts do not prove
current availability. Query one service when needed, not every reservation with bare status.

## 4. Merge in batches, tag what is good

The Orchestrator merges ready handoffs in a batch, runs the full suite and the smoke test
once, fixes seam breakage, tags a milestone, and updates the dashboard. A batch that cannot
be made green in fifteen minutes is reverted and returned to its lane. Green means the
suite exits zero: there is no list of accepted failures.

The Foreman sets priorities, assigns builders and accepts results. The Orchestrator is
the single merger and release executor and acts on the Foreman's direction (the owner,
16 November 2026). Owner-visible interface work goes first in every batch.

## 5. Features default on in normal play

The owner superseded the default-off policy. Developed features must work through normal
entry without special URLs. Keep user off controls, mutually exclusive choices, biome
rules and hardware quality tiers. Report unfinished or broken exceptions explicitly,
with the work needed to validate them; do not silently hide them behind a flag.

The Orchestrator owns shared defaults in `shared/params.ts` and composition in
`src/main.ts`. Lanes may change their own parameter modules and send shared wiring
hunks. Validate the combined default experience, including fresh rooms and deliberate
off choices. Stored room values lack provenance: preserve them rather than guessing
which false values were old defaults and which were host choices.

## 6. Two channels: live and production

The live preview follows every merge. Production is served from Cloudflare and changes only
when the Orchestrator ships a production release: a tagged, green milestone, frozen with
`tools/promote-stable.sh`, deployed from the frozen copy, then verified with
`tools/net-smoke.mjs` against the public address. Each release gets a `release-N` tag and a
line in the digest. The demo runs on production. Overnight releases are authorized
without prior owner viewing. Occupied lobbies do not block deployment. Validate public
assets and gameplay after deployment and roll back immediately on failed live checks.
Keep tested fallback builds; results from one frozen commit do not validate another.

## 7. Handoffs and digests have a fixed shape

Lane to Orchestrator, on handoff:

    Branch and commit:
    What changed (two lines):
    Gate: typecheck / lane tests / smoke
    Touched outside my fence: (none, or what and why)
    Needs the owner's eyes or ears: (none, or what)

Orchestrator to Foreman, at each milestone tag and whenever the owner is needed:

    Tag and test count:
    Merged since last digest:
    In flight, by lane:
    Idle lanes and what they could take next:
    Needs the owner:
    Risks:

Foreman to owner: a short update when something is playable, broken, or needs him. Not a
relay of the above.

## 8. State lives in files, not in a context window

The Orchestrator's thread was 71 percent through its context when this was written. It
keeps `ops/STATE.md` on `main` current at every milestone: lanes and their agent
ids, what each is doing, preview commands, known breakage, and what is owed. A compacted or
replacement Orchestrator must be able to resume from that file and `ops/BACKLOG.md` alone.

## 9. The owner talks to leads directly; decisions still get written down

When the owner gives a lead an instruction in its own thread, the lead follows it and sends
the Orchestrator one line saying what changed and whether it touches a shared seam. The
Foreman reads lead threads on each sweep and records owner decisions in `ops/DECISIONS.md`.

## 10. Continue overnight and prepare the morning handoff

The owner chose continued overnight development and will decide the cutoff in the morning.
Prepare an 8am Pacific brief with verified build choices, known issues and a fifteen-minute
viewing list. The noon handoff is the public address and GitHub repository link.

Finish current assignments first. After every current assignment finishes, the owner's
follow-on priorities are measured performance tiers, toggleable FPS/history/hardware/failure
diagnostics, sustained-low-FPS recommendations, richer cursor-locked UX with minimap-edge
vignettes, complete gear and playful bots, multiplayer playtesting, and transparent water.
Preserve explicit holds such as deferred smooth-ground interpolation. The later default-on
directive applies now and does not wait for that follow-on queue.

## 11. Never kill processes by name

`pkill`, `killall` and any kill that matches on a name or command line are forbidden for
every lane, with no exceptions. Stop only processes you started, by the PID you recorded
when you started them. At 5:30pm on Saturday a malformed `pkill` terminated every lane's
servers, Chrome, the Claude app and the Vorteo host daemons. It was the second name based
kill to cause damage that day.

## 12. Every viewable page is linked from the top of the dashboard

Set by the owner at 7:10pm on Saturday. The dashboard opens with one block of links to
everything he can look at: the live game, production once it exists, each lab page (terrain,
planets, score, effects, bots, skins) and each lane's own preview. A handoff that adds or
moves a viewable page names its path in the handoff note, and the Orchestrator adds the
link in the same merge. Since 16 November 2026 this is the Orchestrator's job at each
merge and not an automated test: a missing link is not a bug a player can hit, so it does
not block a release. Dead links come off, or
are marked down, at each sweep.
