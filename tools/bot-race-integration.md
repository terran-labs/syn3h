# Automatic landmark races

The owner chose automatic starts. The first version enrolls the actively driving host and
nearby ground bots. Guests observe. Remote human enrollment needs explicit driving
readiness; the existing unpaused network state also describes lobby spectators.

The Bots lane owns `BotRaces`, `BotManager.setRaces` and `BotManager.applyRace`.
Multiplayer owns the canonical `RaceUpdate` and `RaceState` types and room validation.
UX owns the destination/countdown/result strip. The Orchestrator owns composition wiring.

Install one stable hooks object on the connected host after its room clock synchronizes:

```ts
bots.setRaces({
  now: () => net.clock.now(),
  candidates: () => candidates,
  publish: update => net.send({ type: 'race', race: update }),
})
```

Each candidate has `{ id, vehicle, active, human }`. Use numeric network IDs, including bot
slots. The host human is active only while the shell is playing and input is available.
Bots must be live, owned by the host, and able to drive. Announce the host's actual driving
state with `race-ready` on connection and changes. Clear hooks on disconnect, authority
loss or disposal. The manager also clears them when it becomes remote.

Call `bots.applyRace(state)` for every canonical race message, including null. The director
waits for this echo before advancing. Rejected publications must return the canonical
state, not leave the host waiting silently. A missing echo expires locally after five
seconds. Server corrections can withdraw participants and advance the revision.

The director waits thirty seconds of eligible play before its first attempt. It chooses a
dry landmark 80 to 250 metres away with a reachable route for every participant and room
around the finish. Routes longer than 500 metres are excluded. The existing grid can take
the long way around a seam; such a route is skipped rather than advertised as a short race.

The countdown lasts five seconds, the race at most two minutes, and results eight seconds.
There is at least ninety seconds between races. Bots wait during the countdown and drive
using their existing terrain-aware pilots. Human controls remain free. A finish requires
crossing into the destination circle at ground level; teleporting into it cannot win.

UI reads canonical state and extrapolates its clock only for presentation. It must not
advance phases or decide winners. Show the wrapped destination distance, countdown and
winner. Distinguish observers from participants. Leave withdraws only the local participant;
Hide affects local display; Cancel is host-only. No focus capture or modal dialog.

World changes and host changes cancel the race. Withdrawals cancel only when fewer than
two competitors, or no human, remain. Runtime restore cancels an active race; it never
reconstructs the old host's simulation.
