/**
 * The keys the in-play help names, as KeyboardEvent.code values, and how each is written.
 *
 * The game binds its keys as literals where it reads them (src/core/Input.ts for the shared
 * axes, src/vehicles/Jet.ts for the jet's lift and thrust). This table is what the help says;
 * tests/ui/help-bindings.test.ts fails if a code here is no longer bound there, so a changed
 * key cannot leave the help teaching the old one. When those files read this table instead,
 * that test has nothing left to catch.
 */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  /** Buggy wings, jet hover and flight. */
  special: ['Space'],
  brake: ['ShiftLeft', 'ShiftRight'],
  fire: ['KeyL'],
  /** The jet's lift in hover and thrust in flight (Jet.ts liftKeys; JET_LIFT_KEYS 1 is E up). */
  jetUp: ['KeyE'],
  jetDown: ['KeyQ'],
  help: ['KeyH'],
} as const satisfies Record<string, readonly string[]>
export type KeyAction = keyof typeof KEYS

/** A key code as printed on the key: KeyE is E, ShiftLeft is Shift, ArrowUp is ↑. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
  if (arrows[code]) return arrows[code]
  return code.replace(/(Left|Right)$/, '') || code
}
/** The key the help shows for an action: its first binding. */
export const keyFor = (action: KeyAction): string => keyLabel(KEYS[action][0])
