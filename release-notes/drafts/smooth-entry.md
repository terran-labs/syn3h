# Draft notes: smoother entry into a world (perf/smooth-entry)

For the release that ships this branch. Fold into `release-notes/releases/<version>.md` and
the player digest, then delete this file.

## What changed

- Clicking a planet no longer freezes the game. The world is prepared behind the galaxy's
  dive: its heights are generated in a worker, its meshes are rebuilt a piece per frame, and
  its shaders are built in two frames drawn while the dive holds still. At High, measured
  against v26.11.1706: the worst frame from click to drivable fell from 433 ms to 150 ms,
  and frames over 50 ms from 11 to 2. Medium on a phone-sized view improved as much.
- The dive holds in the air while preparation runs long, for at most 15 seconds, then
  lands with whatever is ready.
- Leaving a world climbs back out of it, then the galaxy eases home: about 2.5 seconds,
  with no frame worse than leaving was before.
- Bots arrive one at a time near the player, in the arrival cloud, an interval apart.
  A bot leaves again only if it measurably slowed a game that was keeping its frame rate.
  Bots also arrive while the host is in the lobby or a menu. Guests see the host's bots
  arrive one at a time too.
- If the terrain worker cannot load or does not answer, the world is generated on the main
  thread instead.

## Known limits

- Bots never arrive below about 3 frames a second: the pacer needs five frames in 1.5 s to
  judge a bot, and a page that slow never gives it them. Not fixed.
- On 120 Hz displays a bot can be judged as costly when the frame time rises by a single
  refresh step (8.3 ms), which load alone can cause. Seen once, at load 11. Proposed fix:
  confirm "worse" over a second measuring window before sending a bot away. Not fixed.
- Ultra was not measured: the machine was never quiet enough. Both this build and the
  previous one compile GPU pipelines there in frames of several seconds.
