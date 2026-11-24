# Decisions

One entry per owner decision: date, what was decided, why, and what it changes.

## Monday 23 November: diagnostic link switches stay in every production release

**Decided** by the owner, in his words: "I love all your URL params to test different
parameters in the game. Please continue leaving these in for all future production releases
so we have field diagnostic capabilities from this point forward."

**Why.** The black flashes on his iPhone could not be reproduced on our machines. Link
switches let him turn one thing off at a time on his own phone, and that is how the flashes
were traced to sun shadows on Safari WebGPU (v26.11.2304). A bug seen only in the field
needs field switches, and they must still be there the next time.

**What it changes.** Diagnostic link switches ship in production and stay: none is stripped
when the bug it served is closed. Each is read once at start, changes nothing when absent,
and is named in the copied Diagnostics report. A new device-specific gate gets a switch to
turn it on and off. The set on 23 November: ?webgl=1, ?gfx=N, ?diag=1, ?blank=1,
?shadows=0, ?shadows=1, ?shading=0, ?post=base|off, ?samples=1, ?lowrest=1, ?freeze=1, ?ui=flat, ?gpuTrace=1,
?frameCanary=1, ?frameProbe=1, ?canvasBackdrop=1, ?presentHold=1, ?canvasAlpha=opaque, ?shadowCascades=1, ?shadowMap=512|1024|2048, ?shadowColor=0, ?shadowFilter=hard, ?shadowFade=0.
They are also rows in Performance, Diagnostics, Field switches (src/core/fieldSwitches.ts).
The rule is in AGENTS.md.

## Monday 16 November: code under PolyForm, creative work under CC BY-NC-SA 4.0

**Decided** by the owner. The code keeps the PolyForm Noncommercial License 1.0.0. The
creative work is added under Creative Commons Attribution-NonCommercial-ShareAlike 4.0
International, attributed as "Syn3h by Terran Labs, https://www.syn3h.com".

**Why.** Creative Commons recommends against its licences for software, and they grant no
patent licence, so PolyForm stays the right fit for the code. CC BY-NC-SA fits the
writing, meshes, images and videos, and its share-alike term keeps remixes of them open.

**What it changes.** `LICENSE-CC-BY-NC-SA.md` holds the official, unmodified legal code.
`NOTICE.md` says which parts fall under which licence, that a file which is both is code
while its shared output is creative work, that third-party components keep their own
licences, and that neither licence covers the Syn3h name or logo. The README and the About
screen name both licences. `LICENSE.md` and the package's SPDX identifier are unchanged.
Outside contributions now need an agreement that covers both licences; none exists yet.

## Sunday 15 November, overnight: normal-entry features and continued coordination

The owner directed all developed features to default on without special URLs. This
supersedes the earlier default-off policy. Keep player controls and performance tiers;
explicitly identify unfinished features and validation gaps. Do not treat mutually
exclusive vehicle, biome, music or interface choices as switches that must all be on.

The owner established an overnight goal: finish existing assignments, then improve
performance tiers and diagnostics, cursor-locked UX with minimap-edge vignettes, gear,
playful bots, multiplayer reliability and visibly transparent water. Diagnostics should
show FPS and history, rendering factors, detected hardware and rendering failures.
Sustained poor performance should offer one floating control to ignore advice or lower
the rendering tier. Prepare the morning brief at 8am Pacific.

## Sunday 15 November, overnight: deployment occupancy and generated wind

The Orchestrator relayed the owner's direct instruction never to hold deployments
because someone is in a lobby. Frozen-build validation, public checks and immediate
rollback remain required. Occupancy is no longer a release gate.

The owner answered the wind question: generated wind only. UX owns removing the recorded
wind layer. This supersedes the recording-retention rule for wind only; the music
and laser recordings remain.

## Sunday 15 November, 11:33am Pacific: full version numbers, and a frozen build for judges

**Decided** by the owner. Builds are named by their full version (v26.11.1503), not by an
integer release number. Judges must be able to load the build frozen before noon by a
version parameter on www.syn3h.com, so he can keep building and shipping after noon while
the project is judged fairly against others finished at noon. The functionality ships
before noon.

**What it changes.** v26.11.1503 (live since 11:20am) is the build frozen before noon. The
Orchestrator adds version-addressed serving to the site, with a direct frozen link as the
fallback, and does not ship a protocol change that would force a frozen build to reload.
Later releases must keep earlier frozen versions loadable.

## Sunday 15 November, 11:24am Pacific: licensed under PolyForm Noncommercial 1.0.0

**Decided** by the owner: "Update our Git repo with the PolyForm Noncommercial." He wants
people free to extend the game but not to make money from it without a licence from him.
The public repository had no licence at all.

**What it changes.** `LICENSE.md` holds the official, unmodified text; `NOTICE.md` carries
the required notice and how to ask for a commercial licence; the README and package
metadata name it. Syn3h is source-available, not open source in the strict sense.
Contributions from others will need a short agreement so he can license the whole
commercially. The copyright holder is written as Terran Labs unless he says otherwise.

## Sunday 15 November, 10:45am Pacific: three places to look, one dev preview with everything

**Decided** by the owner: "Eliminate all the outstanding extraneous previews. We should only
have the live site, the live dev preview, and the vehicle lab. Merge all latest work into
the live dev preview ASAP." He is told through Open questions when it is ready. Finishing
the interface is his highest priority for the remaining hour.

**What it changes.** One dev preview serves the integration branch and receives every
lane's work as it passes typecheck and unit tests. The UX, Post Effects, water and other
lane previews are stopped through the broker; lanes verify on local servers. The release
check stays separate and still runs every browser check. The second build freezes when the
interface work arrives green or at 11:10am, whichever is first, and sheds from the bottom
of his priority list. Release 6 went live at 10:19am.

## Sunday 15 November, 9:32am to 9:45am Pacific: physics engine loading, and a lobby of planets only

**Decided** by the owner.

- The physics engine loads alongside the lobby and ships as a separate compiled file, in
  today's demo release if it can be done safely.
- No fallback if it fails to load: the player is told the game could not load and to reload.
- The lobby offers no vehicles, only planets to click. Vehicle choice lives in play.

**What it changes.** Performance builds one loading path for the engine and a reload
message for failure. The tank is not added to the lobby; the in-play selector lists all
four vehicles. A lobby that is interactive before the engine arrives needs a startup
restructure and follows the demo. Release 6 was cut early, at about 9:40am, to take the
recorded audio off the live site sooner.

## Sunday 15 November, 9:05am to 9:40am Pacific: pause, panels and touch stick

**Decided** by the owner, in four messages.

- The game does not run in a background tab: audio fades out and pauses, and nothing
  consumes CPU.
- Escape with the cursor already free pauses, with a floating "Paused. Click to resume"
  message and all audio fading to zero over about 500 ms.
- Panels being open or closed is a function of cursor locking alone; there is no separate
  panel state. Locked means driving with panels closed; free means panels open.
- The touch joystick floats: it appears where the first drag begins, with no permanent
  stick in the lower left.

**What it changes.** One pause controller serves both the hidden tab and Escape. UX removes
the stored panel state and defines the single equivalent state for touch. What other
players see when a guest or the host is paused is still to be decided by the Orchestrator.

## Sunday 15 November, 9:15am Pacific: one approved design per vehicle in the noon release

**Decided** by the owner: "In the version we're shipping at noon today, there should only be
one approved hovercraft, buggy, tank, and jet. You shouldn't be saving old versions that are
loaded into the game."

**What it changes.** The noon release offers four vehicles with one design each. Alternate,
study and superseded designs are not loaded, bundled or reachable by sliders, links, saved
settings or bots; the vehicle lab stays out of the production build. The hovercraft and tank
ship in their current model-based form, since he has not approved a generated body for
either. Design-selecting parameters on the hovercraft and tank branches stay out of the
candidate.

## Sunday 15 November, 9:02am Pacific: new vehicle designs are announced as questions

**Decided** by the owner, in the Hovercraft lead's thread: "Send me a global question
message whenever new vehicle designs are available, including for the hovercraft, tank, any
other vehicles. Apply this as a rule in the vehicles thread."

**What it changes.** When a design round is verified live in the shared vehicle lab, its
lead asks him through Open questions, with the designs as options and the lab link. The
Vehicles lane records the rule and passes it to every vehicle lead. A lead copies the
Foreman when it asks.

## Sunday 15 November, 9:05am Pacific: gear names and looks approved

**Decided** by the owner. Player-facing names: Plasma Tag (was tag beam), Plasma Thunder
(was Big Red), Chaser (was Pesters), Grapple (was Bungee), Yoink. He approved the Weapons
lane's first recommendation for each item's look and synthesized sound. Internal
identifiers and wire messages stay as they are. At 9:22am he added: the Syn3h Buggy is
called simply the Buggy, now that the classic buggy is gone.

## Sunday 15 November, 9:00am Pacific: the rule is what the running game loads

**Decided** by the owner: "Binary assets in the codebase are okay. Binary assets that get
loaded into the running game are unacceptable."

**What it changes.** The release check is defined by the requests a scripted play session
makes, not by what the repository holds. Install icons and the share card stay as checked
in, because the game never loads them; no build-time generation is needed. Fonts are
loaded at run time; he then chose to keep Barlow, trimmed to the weights used, as a
standing exception. The vehicle models kept for noon are the one dated exception. The physics
engine's compiled code is classed as code, not an asset, and is reported to him with its
size so he can object. `AGENTS.md` is updated.

## Sunday 15 November, 8:55am Pacific: classic buggy removed; live models stay for noon

**Decided** by the owner, answering the Foreman's question on the 1.7 MB of vehicle models.

**What it changes.** The classic buggy leaves the game now, with its model files; old room
links and saved sessions that name it fall back to the Syn3h buggy. Unused model files and
the two dead textures are deleted. Models the game still loads (Syn3h buggy, tank and
treads, hovercraft) stay for the noon release on an explicit approved list and are replaced
by generated vehicles after the demo. Questions on the install icons, the share card and the
Barlow font are still open with him.

## Sunday 15 November, 8:20am Pacific: no recorded audio or baked textures ship

**Decided** by the owner: "There shouldn't be any pre-generated textures, audio files, or
any other large binary data." He asked why the release 5 lobby plays the recorded music
and not the synthesised score.

**Why it happened.** The audio code defaults to the Space Station recording; the generated
score was an opt-in choice in the music selector. That followed the earlier rule that his
recorded originals stay, which this decision withdraws.

**What it changes.** The generated score becomes the default and only music, lobby
included. The four recorded tracks, the three recorded cues, the unused wind recording and
the two vehicle textures leave the build; cues are synthesised. A release check will fail
on any shipped audio file or non-required image. Install icons and the share card stay
because platforms require bitmaps. Vehicle meshes (about 1.9 MB) are kept for the noon demo
and put to the owner as a separate question. `AGENTS.md` is updated to match. Not live:
release 5 still plays the recording until a successor passes its checks.

## Sunday 15 November, overnight: coordinated validation queue

After host load exceeded 40 and preview validation stalled, the Orchestrator removed
the load-based throttle bypass. Every heavy job now takes one of three machine-wide
slots. Each lane runs one queued job with at most two test workers during recovery.
Release jobs use the same queue. The temporary blanket heavy-job hold has been cleared.

## Saturday 14 November, about 11:15pm Pacific: roads are worn tracks except on the alpine world

**Decided** (Terrain Lab thread, relayed by the Orchestrator). "I don't think anything
other than the alpine forest should have the clean asphalt road with edges". Every planet
but alpine draws its roads as worn tracks. On trunk; not in release 3.

## Saturday 14 November, 11:26pm Pacific: the throttle comes back in a gentler form

**What happened.** Lifting the throttle at 10:13pm raised load to 30 to 45. The preview
broker's health checks time out at that load and it fails closed, so every preview link
went down at about 11:10pm. The device list had not changed; nothing needed re-approving.

**What changed.** Heavy jobs now run at low priority, vitest is capped at three workers a
run, and jobs queue above a load of 8 with five slots. The Foreman restarted the game,
dashboard and vehicle lab previews through the broker on the owner's request. If the
owner wants no throttle at all, the cost is that his preview links drop under load.

## Saturday 14 November, 10:25pm to 10:35pm Pacific: four decisions in the Foreman thread

1. **Releases may go public overnight unseen.** "Yes. All new releases may go public
   overnight without me looking at each one. Keep shipping as fast as you can." The
   Orchestrator ships on its own checks, rolls back at once if a check on the live site
   fails, and keeps the fixes only build ready.
2. **The judges' hand-over at noon** is the public address https://www.syn3h.com/ and the
   GitHub repository link. Nothing else needs preparing.
3. **Weather is a go.** Wind as a real force on vehicles, zorb balls especially; a
   generated wind sound heard relative to the camera, so a chase camera behind a fast jet
   hears it too; and more fog on "pretty much all worlds, unless there's a world like a
   moon that really doesn't need fog". A Weather Lab lane owns it. The owner authorised new
   Codex workspaces, but the platform does not let the Foreman start Codex threads, so the
   lane started on Claude 1 for him to move.
4. **No "(AI Generated)" line on published releases,** "past, present, and future". It is
   removed from the two live GitHub releases, the notes files and the tool. This is an
   exception for release notes; his general rule for other posts stands.

## Saturday 14 November, about 10:15pm Pacific: no cut-off; build and ship as fast as possible; noon is the hand-over

**Decided** (Terrain Lab thread, relayed by the Orchestrator). "Tell the Orchestrator to
eliminate its cutoff and just continue building and shipping everything as fast as we
possibly can. I'm going to be hand-managing this. I'll decide what the cutoff is tomorrow.
Our final deadline cutoff is at noon. that's when the judges need this handed over."

**What it changes.** The 9am Sunday cut-off for release 3 is gone, and so is the Foreman's
"nothing after 10am" limit; the owner sets the cut-off himself on Sunday. Trunk keeps
landing as fast as the gate allows. Open, asked of him at 10:25pm: whether "shipping"
includes public releases to www.syn3h.com that he has not looked at, and what the judges'
hand-over at noon consists of. Until he answers nothing is deployed. Also approved in that
thread: six new planets (Archipelago, Ice moon, Obsidian, Badlands, a low gravity Moon, a
Methane swamp).

## Saturday 14 November, 10:10pm Pacific: unthrottle, and review every half hour

**Decided.** The owner asked why there is a throttle at all and for everything to be
unthrottled, and for a review every half hour of optimizations made, problems smoothed
out, and help needed from him.

**Why.** At 10:08pm the three heavy job slots were full with about fourteen jobs waiting,
while load was 14 on 12 cores and memory was 92 percent free. Trunk merges had fallen
from 33 an hour to 2.

**What it changes.** The throttle becomes load aware: jobs run at once while the machine
has room, and queue for one of eight slots only when load passes 12. The gate helper gets
its own slot. The Foreman reviews every half hour through the night.

## Saturday 14 November, 10:40pm Pacific: releases tell the story of the build; one GIF frame per scene

**Decided.** The GitHub releases should tell the story of the project from its start, in
more granular steps than the two public releases. The owner allowed deleting and
recreating the existing ones. The showcase GIF holds exactly one frame per composed scene.

**What it changes.** Fourteen releases, one per chapter of the day: twelve milestone
builds, each marked as not released publicly, then the two public releases, renumbered
v26.11.1412 and v26.11.1413. Each has a short narrative of what happened in that stretch
and screenshots of the game as it was then. The GIF is rebuilt with eight frames.

## Saturday 14 November, about 10:30pm Pacific: the pointer steers the camera

**Decided** (UX thread, relayed by the Orchestrator). "Our interface should capture the
cursor. Moving the cursor around should orbit the camera while driving, unless Escape is
tapped."

## Saturday 14 November, evening: four decisions made in lead threads

Relayed by the Orchestrator at 9:30pm with the owner's words as the leads quoted them.

1. **No large vegetation on any world** (Terrain Lab thread). "The alpine trees look
   absolutely ridiculous, and they're destroying it for me. Eliminate all large vegetation
   such as trees from all worlds, eliminate cacti, etc."
2. **Planets are drawn larger than true** (Terrain Lab thread). "Yes, definitely draw
   planets larger than true." Roundness defaults to 0.4, so the summit shows from every
   spawn pad. This settles the opening view gate, pending his look at the comparison page.
3. **Wrapping is always on** (Terrain Lab thread). "Wrapping should not be optional.
   Wrapping is a core feature." The wrap switch is deleted. Consequence: round planets
   cannot ship without the wrap, so the full trunk option depends on the seam checks.
4. **The galaxy lobby replaces the panel lobby** (UX thread). "Replace the lobby ASAP",
   "Don't hold back. Try shipping the full Galaxy Lobby now". It is the default on trunk,
   with the panel lobby as fallback.

## Saturday 14 November, 9:10pm Pacific: calendar versions, release notes and GitHub releases, as in Freed and Vorteo

**Decided.** Syn3h adopts the versioning, release notes and GitHub tagging used by Freed
and Vorteo. Every earlier production release is published retroactively as a tagged
GitHub release with full notes and screenshots.

**What it changes.** Production versions are `YY.M.DDBUILD` with a `v` prefix, the build
counting from 00 each day: release 1 becomes v26.11.1400 and release 2 becomes v26.11.1401.
The `release-N` tags stay, because the release, rollback and domain tools use them. Notes
live in `release-notes/releases/` and follow Freed's shape: the "(AI Generated)" line, a
one line deck, features, fixes, how to play, known issues, and screenshots captured from
that release's own frozen build. The release script writes the version into the build
file and drafts the notes; the showcase GIF attaches to the same GitHub release.

## Saturday 14 November, 9:05pm Pacific: every production release makes a showcase GIF for the README

**Decided.** As in the Freed project, each production release generates an animated GIF
of the game's best scenes, and the GitHub README embeds it. The owner named bots, visible
tag beams, the lobby and vistas, and left the rest to the Foreman's judgment.

**What it changes.** A capture tool renders a fixed list of scenes from the frozen release
build, assembles a looping GIF and uploads it with the stills to a GitHub release for the
release tag. The README embeds the latest release's GIF, so it follows production without
further commits. A failed capture is reported loudly but never blocks or undoes a release
that is already live. The first one is made for release 2 without redeploying. The README's
own wording is brought in line with the no violence rule at the same time.

## Saturday 14 November, 8:40pm Pacific: keep building overnight, decide the demo build in the morning

**Decided.** No feature freeze tonight. Lanes keep building overnight. Which build runs the
demo is decided on Sunday morning.

**Why.** The owner wants as much of the vision as possible in front of the audience. The
Foreman recommended a freeze at 9:30pm with one approved release by 10am; he chose to
keep going.

**What it changes.** Release 2 stays public overnight. Nothing deploys overnight, because
the bar for release 3 needs the owner's eyes. So that the morning decision is a choice
between tested things, the Orchestrator keeps three options ready: release 2 as it is; a
fixes only build (release 2 plus the worded loading veil, the bounded start and any
defect fixes); and full trunk. Standing limits: no release while anyone is playing, none
after 10am Sunday without the owner's word, and the opening view must show the volcano.
The Foreman sweeps hourly overnight and has a morning brief ready by 8am.

## Saturday 14 November, 6:25pm Pacific: cut over syn3h.com as soon as possible

**Decided.** "Cut over ASAP." The owner gave his word for the domain switch without
waiting to see release 1 on the workers.dev address first.

**Why.** He wants the game on the domain tonight. The Foreman had recommended he
see release 1 first; he chose speed. Rollback takes about a minute.

**What it changes.** As soon as Cloudflare access exists: ship release 1 from the current
candidate, and if its automated checks pass on the workers.dev address, export the zone
and attach www.syn3h.com at once with the owner approved flag. The automated checks still
gate the switch; the owner's viewing does not. Scope is www only; the apex redirect and
all mail records are untouched. Account facts from his screenshot: workers.dev subdomain
af-4e7, no existing Worker named syn3h, free plan at the time.

## Saturday 14 November, about 6:15pm Pacific: wild shores, and wings float you out

**Decided** (in the Terrain Lab thread, relayed by the Orchestrator).

1. Shores stay wild. Guaranteed beaches were built and reverted on the owner's word.
2. "Buggies should float very aggressively when their force field wings are deployed. This
   allows them to climb out of any situation." Wings are the way out of steep coasts and of
   lava.

**What it changes.** The Vehicles lane builds the aggressive wing float, with captures
required. UX adds a HUD hint. No terrain work on beaches.

## Saturday 14 November, 5:32pm Pacific: Cloudflare Workers Paid, and keep the relay

**Decided.** Build production on Cloudflare Workers and pay the 5 USD a month for Workers
Paid. The room server stays a WebSocket relay; no switch to WebRTC peer to peer tonight.

**Why.** The free plan's 100,000 room requests a day would be spent in about two hours of a
full room, and tonight's testing shares that day with the demo. Peer to peer fails on
phone and venue networks and would replace tested code the night before the demo.

**What it changes.** The owner upgrades the account. Release 1 still waits for Cloudflare
access on this machine. A packet loss study and a venue fallback runbook are in flight.

## Saturday 14 November, about 5:15pm Pacific: no death or violence in any world

**Decided** (in the Terrain Lab thread, relayed by the Orchestrator). No death or violence
in any world. Lava is sticky and makes things glow. Vehicles are indestructible.

**What it changes.** King of the Hill no longer eliminates: a vehicle in lava is stuck and
glowing, then returns to its pad or drives out slowly. The Orchestrator is routing this to
Multiplayer, Vehicles, UX and Bots. Laser tag: decided at 5:22pm. The mechanic stays and is
renamed tag beams, with no weapon wording anywhere in the interface.

## Saturday 14 November, about 5:15pm Pacific: classic buggy is off the MVP

**Decided** (in the classic buggy thread, relayed by the Orchestrator). The classic buggy
lane is closed and the vehicle is off the MVP. Its post-MVP list is `TODO.md` at the repo
root. Open: whether it stays selectable in the lobby.

## Saturday 14 November, about 5:15pm Pacific: threads the owner switches may run on Claude 2

**Observed, not yet confirmed by the owner.** The UX, jet and hovercraft threads report
that the owner moved them to Claude 2 himself. The Orchestrator and Foreman treat that as
his choice for those threads. Neither starts anything on Claude 2.

## Saturday 14 November, 5:00pm Pacific: production replaces the current syn3h.com tonight

**Decided.** The production release of the new game replaces the site now at syn3h.com,
tonight. (The owner's message said "synth.com"; the Foreman read that as syn3h.com and
asked him to correct it if wrong.)

**Why.** The owner wants the new game to be what the domain serves.

**What it changes.** Production's address is syn3h.com, not only a workers.dev address.
Facts checked at 5:00pm: the domain's DNS is already on Cloudflare; the apex redirects to
www; www serves a page titled "Syn3h - A Community of Creators"; the domain receives email
through Google, so mail records must not be touched. Order of work: ship release 1 to the
workers.dev address and verify it, record the existing DNS records for rollback, then
attach syn3h.com and www to the Worker. Blocked on Cloudflare access. The cutover itself
waits for the owner's word after he has seen release 1.

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

## Saturday 14 November, 4:24pm Pacific: publish the repo

**Decided** (in the Orchestrator's thread). The `syn3h` repository goes public now.

**What it changes.** The Orchestrator is carrying this out. The API keys committed in two
other public repositories still need revoking by the owner.

## Monday 16 November, about 10:28pm Pacific: generated skins for every vehicle

**Decided** by the owner, in the generated-vehicles thread: "You are authorized to ship
generated skins for all vehicles now, including the buggy."

**What it changes.** The game loads no vehicle model files: the buggy is generated in code,
and the tank's legacy model path is deleted. The model files move from public/models to
tools/models as source material, never copied by the build, and the run-time asset check
fails on any model request. This supersedes, from the release that ships veh/generated-vehicles,
the entries above that kept the hovercraft and tank in model-based form for the candidate,
that named the vehicle models as the one dated exception, and that kept the live models for
the noon release.

