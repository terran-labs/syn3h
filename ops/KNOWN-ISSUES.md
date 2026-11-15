# Known issues

Current public release: release-4, v26.11.1500, accepted 15 November 2026 at 03:05 PST.
The release record and `ops/STATE.md` identify the exact source and validation evidence.

- Real phone/iPad performance, venue networking, QR entry and listening remain unverified
  on the owner's hardware. Automated browser checks are not physical-device measurements.
- Wide touch layouts can overlap the flight joystick and bottom-left minimap. A tested
  correction is in the next batch, not the current public build.
- Water is opaque from above. Depth colour does not reveal submerged geometry.
- Aircraft Pester avoidance is unfinished. The response study produced two escapes and
  two harmful catches; ground dodge and bot tool use remain independent delivered features.
- Indirect light uses screen-space information. Offscreen surfaces cannot contribute.
- Earlier loaded-host startup stale-state failures remain unexplained. The accepted seam
  check verifies steady-state dry driving after bounded readiness, not every startup or sea route.
- A public bot-start check failed on the first release-4 attempt. Unique test rooms now
  prevent persisted fixture reuse, but reuse was not proven as that failure's cause.
- Cloud volumes, temporal antialiasing, saved-world moons and the touch correction are
  under combined next-batch validation. Tank and hovercraft study selection remains open.
- Smooth near-camera terrain remains deferred. Current vehicle feel and sound still need
  the owner's review; earlier buggy driving feedback was already addressed.

## Historical record, not a current release checklist

The following November 14 snapshot is retained for investigation. Its claims about defaults,
public versions, UI behavior and untested owner driving must not be presented as current
without fresh verification.

Kept by the Orchestrator. Last revised Saturday 14 November, 8:15pm PST. These ship as known
in the public release by the Foreman's decision, on the grounds that a fresh room opens on the
volcanic world in paused daylight.

Closed since the first list: the lava sea burning to white at night (fixed at its cause, the
sky's auto exposure); the alpine summit road (climbable: bots and a calmer driver both reach
the top; fast autopilots leave it); the chase camera dipping under the lava or sea at a
shore (it now stays above the liquid surface); tag beams nearly white at night; steep shores
(the owner chose wild shores with wings as the way out); the buggy barely turning at cruising
speed (reported by the owner, fixed on trunk after m13, in release 1); the two wing-lift problems, the rear-end shove and the jet lift-off hint (all
fixed on trunk for release 2).

| Issue | Where it shows | Owner |
|---|---|---|
| syn3h.com (the apex) still points at the old host, which is what redirects it to www. If that hosting account lapses the apex stops working. Fix after the demo: attach the apex to the Worker | Production | Orchestrator, owner's word |
| The dev preview link takes about half a minute to first frame on an iPad (28 MB uncompressed from the dev server); production sends about 2 MB and starts in 1.4 to 2.9 s. Demo from production only. The loading veil is a dim ring with no words | Preview link; veil everywhere | UX for the veil |
| One two-player check failed on www within a minute of the release 2 deploy (a clamped slider reached player A but not B); three reruns passed. Possibly a room straddling two Worker versions during a deploy | Production, during deploys | Multiplayer to assess |
| The generated score is the default on trunk only; release 2 ships the recorded default. The owner wants it better before it is the default | Music | Soundscape thread, owner |
| Bots reach every summit, then ram each other and some drive off the edge; one of four left the alpine road at the last bend | Summits, alpine road | Bots and QA |
| Joining a room stored by an older build could give a hybrid world. Fixed on trunk after m13; release 1 (m13) relies on fresh room names | Rooms that outlive a release | Multiplayer |
| The loss and stall study is one run per condition on a loaded Mac at about 15 frames a second; nothing measured on a phone, venue wifi or mobile data. Read its numbers as indicative only | Network | Multiplayer |
| A dev server restart mid-session can stop the physics world (seen once, no stack) | Development only, not in a frozen release | Bots and QA |
| Changing vehicle in the lobby reloads the page | Lobby | Orchestrator |
| Nothing has been driven by hand, heard, or tried on a real phone | Everywhere | Owner |
