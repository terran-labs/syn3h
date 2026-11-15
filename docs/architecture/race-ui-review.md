# Automatic landmark race UI review

Design review only. No race UI is implemented. The Bots lead proposes host-managed races
with a five-second countdown, a two-minute limit, an eight-second result and at least
ninety seconds between races. Nearby ground bots target a reachable dry landmark while
the player remains free to drive elsewhere.

## Contract requirements before implementation

- Identify updates by race ID, host epoch and monotonic revision. Define the empty state
  and retention of terminal results so reconnecting cannot revive an old race.
- Supply a room-clock phase deadline, or remaining time plus its sample timestamp on a
  synchronized clock. Receiving an unqualified remaining duration adds network delay to
  every countdown. The UI may interpolate, but never declares a new phase or a winner.
- Include participant status: racing, finished or withdrawn. Preserve the winner's name
  in the result even if that participant disconnects.
- Separate Leave race, Hide and Cancel race. Leaving withdraws the local participant;
  hiding changes only local presentation; cancelling the whole race requires host authority.
- Resolve the proposal's conflict between allowing human withdrawal and cancelling on any
  participant loss. Prefer continuing while enough racers remain, otherwise no contest.
- Cancel on world changes or host transfer as proposed. Define human eligibility explicitly;
  connected spectators must not become participants automatically.
- Destination includes a label, canonical position and arrival radius. UI distance and
  direction use the world's wrapped shortest displacement.

## Presentation

Show a compact destination, distance and countdown strip without capturing focus or
unlocking the cursor. Captured-cursor mode gets a small direction cue and status text that
fits the existing survey display. The unlocked UI exposes Leave race and, for the host,
Cancel race. Hide is a separate local control.

Keep sound optional and respect mute. Results last eight seconds, identify the winner or
cancellation reason, and stay separate from tag scores. Never teleport the player, change
their driving input or open a modal to announce an automatic race.

The Bots lead received these findings. Network review must settle timestamp ordering,
authority, participant eligibility and reconnect behavior before UI implementation.

## Implemented display

`RaceHud` now renders canonical race snapshots through `Shell.setRace(snapshot, roomNow,
role)`. It does not publish state or infer phase transitions. Expired countdowns say
"Waiting for start"; expired running phases say "Waiting for result" until the server
responds. Destination direction and distance use the nearest wrapped image. Hide collapses
only the current race locally; Leave and Cancel call the supplied network actions.

The composition owner installs these hooks after constructing the shell and network:

```ts
shell.onRaceLeave = () => net.leaveRace()
shell.onRaceCancel = () => net.cancelRace()
net.configureRaces({
  isDriving: () => shell.playing,
  setRace: (snapshot, roomNow, role) => shell.setRace(snapshot, roomNow, role),
})
```

The strip hides in the lobby, on disconnect and while input is suspended. Captured-cursor
mode keeps the direction and status but hides controls. It creates no sound, changes no
input and never opens a modal. Winner and destination names use text nodes.

`tests/ui/race.test.ts` covers room-clock units, deadline expiry, role controls, preserved
winner names and seam direction. `tests/ui/race.mjs` checks the mounted display in Chrome
and phone WebKit with canonical-shaped snapshots. Real host/guest automatic-start acceptance
belongs to the Bots lane after root composition; snapshot tests do not establish it.
