# Backlog

Priority order. Each item has a one line acceptance check. The Orchestrator dispatches from here.

Items marked (proposed) come from the Foreman and wait for the owner. The rest follow from
decisions in `ops/DECISIONS.md` or from standing direction in `FOREMAN-BRIEF.md`.

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

- Drive the Syn3h buggy by hand and say what is wrong.
- Listen to the five vehicle voices on real speakers.
- Cloudflare access.
- Revoke the Google Maps, Bing and WRLD keys committed in the old public repositories.
- Tank in the lobby, or by link only?
- Feature freeze time (protocol rule 10).
