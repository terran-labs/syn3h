# Decisions

One entry per owner decision: date, what was decided, why, and what it changes.

## Saturday 14 November, 4:57pm Pacific: pause the classic buggy and tank leads

**Decided.** The classic buggy and tank lead threads are paused for tonight. Their branches
and threads are kept.

**Why.** Machine load reached 50 to 69 on 12 cores with ten lanes running. Neither vehicle
is on the demo's critical path.

**What it changes.** Eight lanes remain. Both paused leads were told to stop their
processes, commit work in progress and report what they found. Only the owner or the
Foreman resumes them. Heavy jobs on all lanes go through `tools/heavy.sh`, three at a time.

## Saturday 14 November, 4:45pm Pacific: the stable channel is production on Cloudflare

**Decided.** The frozen demo build is called the production release and is served from
Cloudflare. Cloudflare is updated each time a new production release ships. There is no
separate stable preview link.

**Why.** The preview service would not start a third link, and a Cloudflare deployment was
needed anyway so the audience can join from phones. One channel does both jobs.

**What it changes.** Protocol rule 6 now reads live preview and production. The Orchestrator
ships production releases: a green, tagged milestone, frozen with the promotion script,
deployed from that frozen copy, then checked with the multiplayer smoke test against the
public address. The Multiplayer lead prepares and verifies the deployment. This decision is
the owner's go ahead to deploy production releases. It is blocked until Cloudflare access
exists on the machine: `wrangler whoami` reported not authenticated at 4:46pm.

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
