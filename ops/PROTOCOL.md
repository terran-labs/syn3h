# Coordination protocol

How the Syn3h lanes work together during the Saturday night push (4:30pm to 9:30pm Pacific)
and through to the demo on Sunday at noon Pacific. Written by the Foreman on Saturday 14
November. The Orchestrator adopted all ten rules at 4:40pm. Rule 6 is adopted but blocked: the
stable preview has no link yet. Rule 10 awaits the owner.

## 1. One trunk, one merger

`build/weekend` is the only integration branch and the Orchestrator is the only thread that
merges into it. Everyone else commits to their own branch in their own worktree and hands
off by message. Nobody but the Orchestrator edits the integration checkout.

## 2. Every lane has a file fence

A lane owns the paths listed for it in `ops/LANES.md` and nothing else. A change outside the
fence is a request to the Orchestrator, which routes it to the owning lane. Shared seams
(the `Vehicle` interface, `shared/params.ts`, `main.ts` wiring, the terrain data contract)
change only through the lane that owns them, and the Orchestrator announces a seam change
to every lane that consumes it.

## 3. One gate, the same for everyone

A handoff is ready when, on the lane branch with `build/weekend` merged in first:

1. `npm run typecheck` passes.
2. The lane's own test folder passes (`npx vitest run tests/<lane>`).
3. `node tools/smoke.mjs <lane preview url>` prints `SMOKE OK`.

Lanes run only their own tests. The Orchestrator runs the full suite once per merge batch.
Ten lanes each running 230 tests and a headless Chrome on one twelve core machine starve
each other and make the timing tests lie. Load average was already 8 to 11 with four
threads active.

## 4. Merge in batches, tag what is good

The Orchestrator merges ready handoffs in a batch, runs the full suite and the smoke test
once, fixes seam breakage, tags a milestone, and updates the dashboard. A batch that cannot
be made green in fifteen minutes is reverted and returned to its lane.

## 5. Land unfinished work dark

Anything not ready for an audience merges behind a URL parameter or a slider that defaults
off, the way the tank already does. This keeps branches short lived without putting half
built features in front of the room.

## 6. Two channels: live and stable

The live preview follows every merge. The stable channel changes only when the Orchestrator
promotes a tagged, green milestone. The demo runs on stable. Promote at least once before
the night ends so a known good build exists before anyone sleeps.

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
keeps `ops/STATE.md` on `build/weekend` current at every milestone: lanes and their agent
ids, what each is doing, preview commands, known breakage, and what is owed. A compacted or
replacement Orchestrator must be able to resume from that file and `ops/BACKLOG.md` alone.

## 9. The owner talks to leads directly; decisions still get written down

When the owner gives a lead an instruction in its own thread, the lead follows it and sends
the Orchestrator one line saying what changed and whether it touches a shared seam. The
Foreman reads lead threads on each sweep and records owner decisions in `ops/DECISIONS.md`.

## 10. Freeze before the demo

Proposed, awaiting the owner: new features stop when tonight's push ends. Sunday morning is
fixes, a hand driven rehearsal on the demo hardware and network, and one final promotion to
stable. Nothing merges after 10am Sunday without the owner saying so. After the freeze, lanes may
still merge work that is off by default (rule 5).
