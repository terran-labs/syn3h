/**
 * Whether a press on the game canvas holds the tag control. The primary mouse button does.
 * A finger does not: on a touch screen a press on the canvas is a drive or camera drag, and
 * treating it as the mouse button held the tag control for the whole drag. Touch tagging
 * has its own on-screen control.
 */
export function pressHoldsFire(e: { button: number; pointerType?: string }): boolean {
  return e.button === 0 && e.pointerType !== 'touch'
}
