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
