# Known issues

Current public release: release-5, v26.11.1501, accepted 15 November 2026 at 03:38 PST.
The release record and `ops/STATE.md` identify the exact source and validation evidence.

- Real phone/iPad performance, venue networking, QR entry and listening remain unverified
  on the owner's hardware. Automated browser checks are not physical-device measurements.
- Water is opaque from above. Depth colour does not reveal submerged geometry.
- Aircraft Pester avoidance is unfinished. The response study produced two escapes and
  two harmful catches; ground dodge and bot tool use remain independent delivered features.
- Indirect light uses screen-space information. Offscreen surfaces cannot contribute.
- Earlier loaded-host startup stale-state failures remain unexplained. The accepted seam
  check verifies steady-state dry driving after bounded readiness, not every startup or sea route.
- A public bot-start check failed on the first release-4 attempt. Unique test rooms now
  prevent persisted fixture reuse, but reuse was not proven as that failure's cause.
- Clouds do not cast terrain shadows. Procedural water, grass and particles skip temporal
  history. Tank and hovercraft study selection remains open.
- Release verification runs from one machine whose route to Cloudflare flaps between data
  centres (MAN, NRT; loc US), so public WebSockets drop with 1006 several times an hour. The
  smoke now rides through such drops (bounded step retries, rejoin checks), but a second
  vantage point, such as a hosted runner, would remove the doubt. Workers observability is off.
- The public net smoke's "lava sticks B" step failed once on v26.11.1603 (16 November,
  about 11:30 PST, workers.dev, run 3 of 5) with no reconnect on any page: B was stuck
  and visible on A, but the room never counted B out of the hill (outB 0). The other
  four runs passed that step. Not yet investigated.
- Headless Chrome 157 (157.0.8103.79, macOS arm64) sometimes kills a test page's renderer with
  a CHECK (EXC_BREAKPOINT) on the thread that renders the page's Web Audio. Recorded 20 November
  2026; revised the same day after v26.11.2008's dry run.
  - Not our worklets: with AudioWorklet modules refused (the dump has no worklet thread at all),
    v26.11.2008's dry run crashed the same way at the ram step (Bob, 04:56 PST) on Chrome's
    "AudioOutputDevice" thread, which renders an ordinary Web Audio graph when no worklet is
    loaded. With worklets loaded, the same graph renders on the "Realtime AudioWorklet thread",
    which is why every earlier dump named that thread. The fault is in Web Audio rendering
    under load, whatever thread does it.
  - For players: a Chrome 157 renderer can crash while rendering this page's ordinary Web Audio
    on a heavily loaded machine. Observed only in headless test browsers at load 12 and above;
    never observed in a real session. No product avoidance is known.
  - Established: all 39 such crash dumps on the release machine since 15 November come from
    Playwright test browsers (remote debugging, unsafe WebGPU), none from a real browser
    session. They cover several test scripts as well as the net smoke, where they land most
    often at the ram step.
  - Ruled out: the page's JS-heap memory (86 to 137 MB; this does not cover the worklet's own
    heap), the "index count of 0" draw warning (in every log), shader building at that moment,
    and the fireworks, freeze and bots work (crashes predate them). The ram's audio burst alone
    did not crash in 60 isolated rams with audio running.
  - Not established: which CHECK fires (no public symbols for this official Mac build; no
    matching Chromium issue found), what the loaded release runs add, and whether players hit it.
  - Avoided in the net smoke only: its pages keep every AudioContext suspended
    (tools/net-smoke.mjs), which stops Chrome's rendering callbacks (a probe counted 46 a second
    running and none suspended); the game then never builds its audio graph. Refusing only the
    worklet modules did not avoid it and was removed. No product change. A draft Chromium report
    awaits the owner's decision to file.
  - Dumps: headless Chrome on macOS ignores `--crash-dumps-dir` and writes to
    `~/Library/Application Support/Google/Chrome/Crashpad/completed`. They hold environment
    variables: keep them on the machine. To print a dump's faulting thread and whether a test
    browser wrote it:

    ```
    python3 -I -c "import struct,sys;d=open(sys.argv[1],'rb').read();n,r=struct.unpack_from('<II',d,8);s={};[s.setdefault(struct.unpack_from('<I',d,r+12*i)[0],struct.unpack_from('<I',d,r+12*i+8)[0]) for i in range(n)];t=struct.unpack_from('<I',d,s[6])[0];c=struct.unpack_from('<I',d,s[24])[0];m={struct.unpack_from('<I',d,s[24]+4+12*k)[0]:struct.unpack_from('<Q',d,s[24]+8+12*k)[0] for k in range(c)};a=m.get(t);print(d[a+4:a+4+struct.unpack_from('<I',d,a)[0]].decode('utf-16-le') if a else '?','|','test browser' if b'remote-debugging' in d else 'not a test browser')" <file>.dmp
    ```
- Smooth near-camera terrain remains deferred. Current vehicle feel and sound still need
  the owner's review; earlier buggy driving feedback was already addressed.

## Automatic quality drops after entering at Ultra or Cinematic

A returning WebGPU session can restore Ultra or Cinematic with Auto enabled and the
level unpinned. If the governor then drops a level, the first visible frame can hitch.
On v26.11.2113 with four bots present, Ultra to High built 84 shader graphs and
requested 63 pipelines. Cinematic to Ultra built 90 graphs and requested 68 pipelines.
Fresh Auto sessions start at High or below. Choosing a preset by hand pins the level
until Auto is explicitly enabled again. Manual changes already use the quality veil.

The released entry preview uses the entry level's shadows for the next level down.
Giving just that neighbour its destination shadows still left 72 graphs and 54 pipeline
requests on the first drop from Ultra, and 112 graphs and 64 requests from Cinematic.
That ruled out the narrow change before timing it.

Preparing every lower level during entry added a median 2.05 s from Play to the first
playable frame at Ultra and 2.59 s at Cinematic on WebGPU (five quiet cold pairs each
on the test Mac). The entry cost outweighed the benefit for this uncommon case.
On WebGL 2 the prototype added a paired median 4.54 s at Ultra and hit the 15 s
preparation cap in three of five entries. At Cinematic it hit the cap in all three.
Its paired median of 1.72 s less time to play there includes abandoned preparation.
Both approaches were set aside pending evidence from a player's session.

## Slow WebGL 2 entry when a top level is selected before Play

On released v26.11.2113, cold WebGL 2 entry took a median 9.02 s from Play to the
first playable frame at Ultra and 18.94 s at Cinematic on the test Mac. The 15 s
preparation cap fired in one of five Ultra runs and two of three Cinematic runs.
The cap bounds covered preparation, which is only part of the Play interval.

In one completed Ultra trace, the program-completion polls cleared at 3.06 s. A
confirmation render took 4.62 s, followed by 4.52 s waiting for the first-frame
callback before the final fence stage. That stage took 0.12 s. The capped Ultra run
lacked stage timestamps, so its exact wait remains unknown. WebGL 2 starts at Medium
or below on its own. Investigation of this manually selected entry path is deferred.

## Vehicle shader builds at Low on WebGL 2

Stepping down to Low while driving the hovercraft built three shader graphs for its
two merged surfaces and duct fans. Switching to the jet at Low built seven graphs.
WebGPU prepares those vehicle variants during entry. Doing the same on WebGL 2 added
0.6 to 0.9 s to every entry, so that preparation ships only on WebGPU. No device
report or measured hitch duration is available for either case.

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
| The dev preview link takes about half a minute to first frame on an iPad (28 MB uncompressed from the dev server); production sends about 2 MB and starts in 1.4 to 2.9 s. Demo from production only. The loading veil is a dim ring with no words | Preview link; veil everywhere | UX for the veil |
| One two-player check failed on www within a minute of the release 2 deploy (a clamped slider reached player A but not B); three reruns passed. Possibly a room straddling two Worker versions during a deploy | Production, during deploys | Multiplayer to assess |
| The generated score is the default on trunk only; release 2 ships the recorded default. The owner wants it better before it is the default | Music | Soundscape thread, owner |
| Bots reach every summit, then ram each other and some drive off the edge; one of four left the alpine road at the last bend | Summits, alpine road | Bots and QA |
| Joining a room stored by an older build could give a hybrid world. Fixed on trunk after m13; release 1 (m13) relies on fresh room names | Rooms that outlive a release | Multiplayer |
| The loss and stall study is one run per condition on a loaded Mac at about 15 frames a second; nothing measured on a phone, venue wifi or mobile data. Read its numbers as indicative only | Network | Multiplayer |
| A dev server restart mid-session can stop the physics world (seen once, no stack) | Development only, not in a frozen release | Bots and QA |
| Changing vehicle in the lobby reloads the page | Lobby | Orchestrator |
| Nothing has been driven by hand, heard, or tried on a real phone | Everywhere | Owner |
