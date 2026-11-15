# Known issues

Kept by the Orchestrator. Last revised Saturday 14 November, 6:55pm PST. These ship as known
in release 1 by the Foreman's decision, on the grounds that a fresh room opens on the
volcanic world in paused daylight.

Closed since the first list: the lava sea burning to white at night (fixed at its cause, the
sky's auto exposure); the alpine summit road (climbable: bots and a calmer driver both reach
the top; fast autopilots leave it); the chase camera dipping under the lava or sea at a
shore (it now stays above the liquid surface); tag beams nearly white at night; steep shores
(the owner chose wild shores with wings as the way out); the buggy barely turning at cruising
speed (reported by the owner, fixed on trunk after m13, so not in release 1).

| Issue | Where it shows | Owner |
|---|---|---|
| Wings lift: a fast wings-open touch on water is grabbed instead of skipping; after lifting out the buggy hovers at 6 m/s and cannot fly away | Any liquid, trunk after m13 | Vehicles lane, fixes uncommitted in its worktree |
| Bots reach every summit, then ram each other and some drive off the edge; one of four left the alpine road at the last bend | Summits, alpine road | Bots and QA |
| Rear-ending a moving car passes the tag but gives the car in front no shove on its own screen (5 of 5) | Multiplayer | Multiplayer, release 2 |
| On a parked jet W alone does nothing; R lifts off and the controls card does not say so plainly | Jet | UX |
| Joining a room stored by an older build could give a hybrid world. Fixed on trunk after m13; release 1 (m13) relies on fresh room names | Rooms that outlive a release | Multiplayer |
| The loss and stall study is one run per condition on a loaded Mac at about 15 frames a second; nothing measured on a phone, venue wifi or mobile data. Read its numbers as indicative only | Network | Multiplayer |
| A dev server restart mid-session can stop the physics world (seen once, no stack) | Development only, not in a frozen release | Bots and QA |
| Changing vehicle in the lobby reloads the page | Lobby | Orchestrator |
| Nothing has been driven by hand, heard, or tried on a real phone | Everywhere | Owner |
