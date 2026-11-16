# Backlog

Priority order. Each item has a one line acceptance check. The Orchestrator dispatches from here.

Items marked (proposed) come from the Foreman and wait for the owner. The rest follow from
decisions in `ops/DECISIONS.md` or from standing direction in `FOREMAN-BRIEF.md`.

## Current execution order, 15 November at 3:05am Pacific

The native Foreman checklist and Orchestrator state track current execution. The older
list below is historical and must not be used to request access or decisions again.
Release 4 is accepted publicly; the owner already authorized overnight deployment and
normal-entry defaults. Occupancy is not a deployment gate.

1. Finish combined acceptance and integration of clouds, temporal antialiasing,
   saved-world moons and touch minimap clearance. Preserve the accepted release while
   testing this separate batch. Check ordinary entry, both rendering backends, saved
   settings and room authority, touch controls, and a fully revealed lobby logo.
2. Complete release notes and showcase capture without undoing an accepted gameplay
   release if an artifact fails. Verify the actual published artifacts before closing.
3. Resolve the aircraft evasion design from measured pilot response. The first overlay
   and later response research are not accepted production behavior. Research found
   two useful escapes and two harmful conversions; any next design needs a safe
   selection rule, fresh held-out cases, perturbation margins and full-lifetime checks.
4. Reconcile remaining lane obligations and explicit owner review items. Do not infer
   completion from idle threads or pick a production tank/hovercraft design for the owner.
5. Once existing assignments finish, execute the owner's performance, diagnostics,
   cursor UX, tools/bots/multiplayer and transparent-water follow-on work. Acceptance
   requirements are in [FOLLOW-ON-ACCEPTANCE.md](FOLLOW-ON-ACCEPTANCE.md). This preparation
   does not clear the owner's ordering condition or the smooth-ground deferral.
6. Deliver the 8am Pacific brief and noon public-address/repository handoff using fresh
   production evidence. Distinguish implemented, tested, integrated and public work.

## After the noon demo, 15 November (owner decisions of that morning)

Tracked here at the owner's request. Each item is decided, not proposed, unless marked.

1. **Lobby before the physics engine.** The lobby must appear and be interactive before the
   physics engine has loaded. Today the shell is built from the world behind it, so the
   lobby waits for the engine. Needs a startup restructure: build the lobby first, start
   the world and physics behind it. The owner accepted that this is not in the demo
   release. Also move the engine's remaining JavaScript glue (about 230 KB) out of the main
   script. Check: lobby interactive with the engine's file blocked; drop into a world
   waits on the loading light; time to interactive lobby reported before and after.
2. **Generated vehicles replace the remaining models.** Buggy, tank and treads, hovercraft
   (809 KB loaded at run time) are a dated exception to the rule that the running game
   loads no binary assets. Check: the run-time asset check's model list is empty.
3. **Reload-free vehicle switching.** The in-play selector is the only way to change
   vehicle now that the lobby offers planets only, and it reloads the page. Check: switch
   vehicle in a world with no reload, with the materialization effect.
4. **Multiplayer away state.** What others see when a guest or the host is hidden or
   paused; a paused host must not freeze the bots for everyone.
5. **Six quality levels and the single scene pass** at full quality.
6. **Ice patches and per-surface grip.** (Proposed to the owner; scoped, not ordered.)
7. **Limiter guard.** Refuse long-lived servers in `tools/heavy.sh` and flag a slot held
   longer than fifteen minutes.
8. **Real-device performance.** A quiet headed run with a blank-page control, and the
   owner's phone, tablet and a mid-range laptop. No frame-rate claim stands without them.

## Historical initial queue

The following records the original afternoon queue, not current blockers. Release 1,
Cloudflare setup and the first buggy handling review have since completed. Other old
items require current evidence before being carried forward.

## Now

1. **Ship production release 1 to Cloudflare.** Blocked on the owner's Cloudflare access.
   Check: the public address serves a tagged build with its build id, a phone on mobile
   data joins a room by QR code, and a later merge to the live build does not change it.
2. **Merge the Bots, Performance and QA lane's two waiting commits.** Check: live demos keep
   running until players choose to reload; full suite green; milestone tagged.
3. **Write `ops/STATE.md`** (protocol rule 8). Check: a fresh thread can name every lane,
   its agent, its branch and its preview command from that file alone.
4. **Fix the dashboard clock.** It read "Saturday 8:50pm" at 4:28pm Pacific. Check: the
   updated time matches the wall clock in Pacific time.
5. **Give idle builders work.** Codex 1 and Codex 3 were idle at 4:30pm. Check: no builder
   is idle for more than ten minutes while this list has unstarted items.

## Next

6. **First impression at load is dark.** The default build opens at night with the controls
   card over the vehicle. Check: on a projector in a lit room the vehicle, road and volcano
   read clearly in the first five seconds. (proposed: default to golden hour)
7. **Network delay reads 342 ms on a local room with a 19 ms ping.** Check: either the
   interpolation delay drops to what the ping justifies, or the reason is documented.
8. (Merged into item 1.)
9. **Multiplayer lane, started 4:35pm.** Check: branch merged up to date, deployment
   prepared to the point of one command, first handoff through the gate.
10. **Five vehicle leads, started 4:35pm.** Check: each has merged `build/weekend`, looked at
    a drive capture of its vehicle, and told the owner its two weakest points.

## Next, high priority (owner, 14 November about 11:15pm, via Terrain Lab)

- **Smooth ground near the camera.** "Let's not do this now, but add it to the backlog as a
  high priority." Within an adjustable distance (about 120 m by default, a per device
  slider) draw the ground at about 1 m with smooth interpolation of the existing 4 m
  heights and exact road cross-sections, and give every locally simulated vehicle, bots
  included, a physics ground patch built from the same maths. "Doing it right in this case
  includes physical interpolation as well as visual interpolation. Tires clipping through
  the terrain is unacceptable." One shared world slider for driven ground detail so all
  players ride the same surface. Owner of the work: Terrain Lab; estimate four to five
  hours. Check: a tyre never sinks below the drawn ground in a capture at 1 m detail, and
  two players on the same slope read the same ride height.

## Waiting on the owner

Historical owner questions: reassess before asking.

- Drive the Syn3h buggy by hand and say what is wrong.
- Listen to the five vehicle voices on real speakers.
- Cloudflare access.
- Revoke the Google Maps, Bing and WRLD keys committed in the old public repositories.
- Tank in the lobby, or by link only?
- Feature freeze time (protocol rule 10).
