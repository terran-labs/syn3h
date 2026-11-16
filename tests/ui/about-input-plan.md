# Actual input and modal browser acceptance plan

Source audit: composition `36364211daae47d7b1ddf8661d9d7eceb0cfaaa7`.
Plan only. Implementation, serving and execution require review and allocation.
Owned future files: `tests/ui/about-input-*`. No product edits.

## Boundaries and existing mechanisms

Use the actual application, Input, TouchControls TAG button, GearRack, BigRed,
Yoink and Bungee. Existing `window.syn3h` exposes game, player, shell, bots,
params and pause; `window.syn3hNet` exposes gear, bigRed, yoink, bungee and stats.
Use actual UI entry, gear selection, TAG and pause/exit controls. Shell.openMenu,
closeMenu and openJoin may exercise additional existing entry paths explicitly;
they do not stand in for native button coverage. Expanded in-play About does not
exist yet: these results cannot certify its future entry/close wiring.

Main installs capture blur/pagehide/hidden cancellation before Shell creation,
uses the Input-only path before networking, binds full cancellation afterward,
and installs synchronous selection cancellation through rack.onChange. Observe
these existing calls without replacing their behavior. Never invoke cancel APIs
as the tested action, replace the NetClient, write external.fire/state.fire,
seed charge/carry flags, or call resetGear to manufacture success.

A later allocated launcher needs an isolated Vite origin with
SYN3H_NO_ROOM_SERVER=1 and an explicitly allocated room server/port for the actual
networked game. Do not reuse or change the existing 8787 service. The prior
secondary DOM fixture needed no room server; this plan has a different dependency.
Use one deterministic world, fixed seed, fixed settings and no autonomous fire.
A second participant is only needed for remote-state preservation later. Initial
Yoink targets may be actual host-owned bots, placed through existing rigid-body
position APIs; record setup separately from the input under test. Do not replace
pick/aim or carry mechanics. Disable autonomous bot control for the staged target
using its existing settings, and verify the target is within the actual aim cone.

## Required instrumentation, confined to the fixture

- Record exact checkout HEAD, clean status and served source fingerprints for
  main, Shell, Input, TouchControls, GearSelector, Net, Gear, BigRed, Yoink and
  Bungee, plus fixture and configuration. Reject a stale origin before input.
- Install transparent wrappers around existing cancellation and send/drop/fling
  methods, preserving this/arguments/return value and restoring them on teardown.
  Log order, active gear, input.fire, charge/ready, yoink.holding/stats, Bungee.mine
  identity/state, game tick, and source pointer/key identity. Count red shots at
  the real local send boundary with shot kind; generic shotsFired alone conflates
  gear. Count fizzles at the existing BigRed cue boundary if accessible without
  mutation; otherwise add an observer wrapper to its actual release method and
  report that narrower evidence rather than invent a counter.
- Capture pointer/key events with type/button/buttons/id/isTrusted, activeElement,
  pointer lock and input suspension. Log start/end/cancel and snapshots, not only
  final booleans. For gamepad, record the exact navigator.getGamepads test shim.
- Observe the FIRST actual fixed step after an event, before any later frame can
  conceal a transient shot/fling. A transparent wrapper around the existing
  ordered systems' fixedUpdate/postPhysics methods records entry/exit snapshots;
  it must call originals once, in normal order. Do not manually tick one weapon or
  advance Game's private accumulator. Cancellation must already be safe in the
  synchronous event snapshot and remain safe after the first normal fixed step.
  If the modal pauses simulation, assert no tick while paused, then inspect the
  first step after normal resume. Use bounded waits for readiness and tick changes.
- Assertions are paired positive/negative: normal release must actually fire/fling;
  canceled release must not. Otherwise an input path that never worked could pass.

## First critical allocation: four small cases

1. **Thunder through the real TAG control.** In a touch-capable Chrome context,
   select Thunder through the real gear UI. Hold TAG until actual bigRed.ready,
   observing selector idle/charging/ready refresh. Verify charge and eligible fire
   survive refresh. Intentional final up sends exactly one red shot, no fizzle.
   Repeat from neutral/cooldown; final pointercancel must clear charge synchronously,
   send no shot/fizzle through the first fixed step, and allow a fresh gesture.
   Touch PointerEvents used for controllable cancel/hold are explicitly synthetic.
   A separate native mouse/keyboard interaction with the actual TAG button verifies
   its real DOM event path, without pretending to be a physical phone gesture.
2. **Yoink through TAG and visible Fling.** Stage one actual target. Hold TAG to
   acquire it; require holding-state refresh with the carry intact. Intentional up
   flings once. Fresh acquisition plus pointercancel gently drops, never flings,
   including the first fixed step. Fresh acquisition then click the actual visible
   secondary Fling button while the original TAG holder remains active: one fling,
   no second fling on the old holder's later end. No direct release() substitutes.
3. **Native held fire across a real modal.** In desktop Chrome, charge through
   native KeyL, open the existing pause UI while still held, then resume without
   releasing KeyL. Assert full cancellation precedes Input suppression/UI cleanup;
   no shot, no rearm on resume. Real keyup then fresh keydown can charge. Repeat the
   critical path for native canvas mouse with pointer lock and actual button hold.
   If headless capture is denied, report the limitation and fail that case rather
   than forcing pointerLockElement. Expanded About entry is not covered here.
4. **No false release with another holder.** Actual TAG plus native KeyL held;
   cancel only the TAG pointer. Surviving KeyL must keep fire and charge eligible.
   Final intentional keyup releases once. Reverse with a canceled final holder:
   no shot/fling. Include partial TAG pointer/key aggregation without clearing
   unrelated owners. No direct beginExternalFire calls in this browser proof.

Stop on the first unexpected failure. These four cases are an initial slice,
not approval of the remaining matrix or a release gate. Run Chrome first;
WebKit repeats after explicit allocation with honest pointer-lock limitations.

## Remaining matrix before full acceptance

- Native mouse chords: primary down, secondary down, primary up delivered as
  pointermove/buttons change, secondary up; reverse release order. Record actual
  events. Retire only the primary owner, no duplicate release or blocked restart.
  Starting primary while secondary is already held remains the documented
  starts-on-move limitation; do not silently claim it supported.
- Held mouse, KeyL/Enter, synthetic gamepad button0 and synthetic touch independently
  across menu, Join, pause and exit confirmation. Closing must not rearm held
  sources; only that source's observed neutral plus a fresh press may rearm.
  Mix sources so one neutral cannot unblock another. Distinguish native keyboard/
  mouse from emulated gamepad and injected touch; no physical-device claim.
- Selection while Thunder ready/Yoink holding via actual Digit/T, UI selection,
  emulated D-pad and host allow fallback. Synchronous cancellation must precede
  the first fixed step. Same-gear selection does not cancel. Preserve attached
  and flying Grapple cord identity, stop reel/wheel/double-tap intent, and retain
  the documented raw V/LB behavior. Do not use full modal cancellation for selection.
- Pre-network lifecycle in normal lobby before Play: native held key, synthetic
  window blur/pagehide and repeated hidden notifications invoke Input-only
  inhibition without exception. Then normal Play/network admission and fresh
  input work. After networking, repeat pagehide/hidden order and duplicate hidden
  while charged/carried. Synthetic document.hidden override must be reversible
  and labeled synthetic, not evidence of real OS background-tab suspension.
- Modal open through actual touch controls must cancel before gesture teardown.
  Resume leaves movement/fire neutral and does not unexpectedly request pointer
  lock. Record focus on entry/exit and require a fresh deliberate play gesture.
- Remote/bot cord and already launched projectile survival: snapshot identities
  before local cancel; retain them after. Use actual second-client messages for
  remote coverage in a later explicitly allocated room, not arbitrary counts or
  replacing Net state. Preserve local versus remote count semantics.
- Test partial-member cancel, stale retired callbacks, repeat cancel/end,
  disposal and final global-listener release using real controls. Existing pure
  helper tests remain useful but do not substitute for the actual app sequence.

## Evidence and launcher contract

Proposed files: about-input-plan.md (this plan), about-input.mjs (later browser
fixture), about-input-observers.mjs (only if keeping transparent observers separate
improves review). Reuse the reviewed bounded supervisor pattern rather than build
another process manager. Exact source, parameters, stage setup, native/synthetic
classification, event order and first-fixed-step snapshots go into one report.
Capture the actual TAG/ready, carried/Fling and paused states only where useful.
All fetches, waits, browser close and overall execution need explicit deadlines.
Record owned PID/start identities, reject occupied ports, preserve previous failures,
and require listener/connect/identity closure and wrapper exit0. No automatic retry.

No source, tests, browser or server implementation is authorized by this plan.
