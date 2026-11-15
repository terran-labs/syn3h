# Backlog

Priority order. Each item has a one line acceptance check. The Orchestrator dispatches from here.

Items marked (proposed) come from the Foreman and wait for the owner. The rest follow from
decisions in `ops/DECISIONS.md` or from standing direction in `FOREMAN-BRIEF.md`.

## Now

1. **Promote a stable build.** Check: the stable preview serves milestone 8 or later, shows
   its build id, and survives a merge to the live build without changing.
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
8. **Public hosting on Cloudflare.** Blocked on the owner's Cloudflare access. Check: a
   phone on mobile data joins a room by QR code.
9. **Start the Multiplayer lane.** Blocked: needs a thread. Check: brief acknowledged, branch
   merged up to date, first handoff through the gate.
10. **Vehicle leads.** Blocked: five workspaces have briefs and no threads. (proposed: start
    only the Syn3h buggy lead until the owner has driven it)

## Waiting on the owner

- Drive the Syn3h buggy by hand and say what is wrong.
- Listen to the five vehicle voices on real speakers.
- Cloudflare access.
- Revoke the Google Maps, Bing and WRLD keys committed in the old public repositories.
- Tank in the lobby, or by link only?
- Feature freeze time (protocol rule 10).
