# Known issues

Kept by the Orchestrator. Last revised Saturday 14 November, 7:30pm PST. These ship as known
in release 1 by the Foreman's decision, on the grounds that a fresh room opens on the
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
| Release 1 has no absolute share card address, so link previews show no image until release 2 | Production | Fixed on trunk |
| About half a minute of black before the first frame on the owner's iPad Pro over the preview link (firstDrawSubmittedMs 32637), then 61 fps on WebGPU with no errors. Cause of the delay and whether production shares it: being measured | iPadOS Safari, probably every phone | QA, top priority |
| The synthesised score is the default music on trunk and nobody has listened to it; it ships as default in release 2 only on the owner's word after hearing it | Music | Soundscape thread, owner |
| Bots reach every summit, then ram each other and some drive off the edge; one of four left the alpine road at the last bend | Summits, alpine road | Bots and QA |
| Joining a room stored by an older build could give a hybrid world. Fixed on trunk after m13; release 1 (m13) relies on fresh room names | Rooms that outlive a release | Multiplayer |
| The loss and stall study is one run per condition on a loaded Mac at about 15 frames a second; nothing measured on a phone, venue wifi or mobile data. Read its numbers as indicative only | Network | Multiplayer |
| A dev server restart mid-session can stop the physics world (seen once, no stack) | Development only, not in a frozen release | Bots and QA |
| Changing vehicle in the lobby reloads the page | Lobby | Orchestrator |
| Nothing has been driven by hand, heard, or tried on a real phone | Everywhere | Owner |
