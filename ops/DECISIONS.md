# Decisions

One entry per owner decision: date, what was decided, why, and what it changes.

## Saturday 14 November, 4:33pm Pacific: start all six empty lanes

**Decided.** Start threads now for Multiplayer and all five vehicle leads (Syn3h buggy,
classic buggy, jet, hovercraft, tank).

**Why.** Maximum parallelism for tonight's push. The Foreman recommended starting only
Multiplayer and the Syn3h buggy until the owner had driven the game; he chose all six.

**What it changes.** Six new lead threads run on Claude 1 with Opus, each in its own
workspace and worktree, as peers of the Orchestrator. Ten lanes now hand off to one
merger, so protocol rules 3 (lane tests only) and 4 (batched merges) are no longer
optional. All six lanes draw on the Claude 1 quota alongside the Orchestrator and Terrain
Lab.

## Saturday 14 November, 4:27pm Pacific: the Foreman coordinates and reports

**Decided.** The Foreman is the owner's single point of coordination and reports on the
work in every other Syn3h thread. The owner plans a five hour push, to about 9:30pm
Pacific, to advance as much of the whole vision as possible.

**Why.** Twelve workspaces now exist. He wants one thread to think in and one place to
hear what is happening.

**What it changes.** The Foreman sweeps every thread about every half hour and reports
what is playable, broken, or waiting on him. The coordination rules are in
`ops/PROTOCOL.md` and the lane map is in `ops/LANES.md`. The chain of command in
`FOREMAN-BRIEF.md` stands: the Foreman directs the Orchestrator only.

## Saturday 14 November, 4:24pm Pacific: publish the new repo, rename the old ones

**Decided** (in the Orchestrator's thread). The new `syn3h` repository goes public now. The
nine old repositories are renamed to `legacy-unity-` followed by their original name.

**What it changes.** The earlier `syn3h-unity-*` naming proposal is dead. The Orchestrator
is carrying this out. The API keys committed in two of the old public repositories still
need revoking by the owner; renaming does not remove them from history.
